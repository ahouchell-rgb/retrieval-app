import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_PAPER } from "../_shared/marking/base-paper.ts";
import { overlayFor } from "../_shared/marking/registry.ts";
import {
  AI_PROVIDER, claimRequest, decodePaperVerdict, finishRequest,
  logUsage, OPENAI_API_KEY, OPENAI_MARKING_MODEL,
  openAIResponse, openAIResponseText, validRequestId, type UsageEvent,
} from "../_shared/ai.ts";

const MODEL = OPENAI_MARKING_MODEL;

const PAPER_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    m: { type: "integer" },
    p: { type: "array", items: { type: "integer" } },
    f: { type: "string" },
    x: { type: "boolean" },
  },
  required: ["m", "p", "f", "x"],
  additionalProperties: false,
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Identify the calling pupil from their Supabase JWT (older clients send only the
// anon apikey → null, and we then just mark without recording).
async function getAuthedUid(req: Request): Promise<string | null> {
  if (!sb) return null;
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const { data, error } = await sb.auth.getUser(m[1]);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch { return null; }
}

// Resolve the school behind a paper attempt's class, so usage is attributed and the
// fair-use backstop can apply. Cached in module scope (a class never changes school
// within a warm instance), mirroring mark-answer.
const schoolIdCache = new Map<string, string | null>();
async function resolveSchoolId(class_id: string | undefined | null): Promise<string | null> {
  if (!sb || !class_id) return null;
  if (schoolIdCache.has(class_id)) return schoolIdCache.get(class_id) ?? null;
  try {
    const { data } = await sb.from("classes").select("school_id").eq("id", class_id).single();
    const sid = (data?.school_id as string) ?? null;
    schoolIdCache.set(class_id, sid);
    return sid;
  } catch {
    return null;
  }
}

// Resolve the paper's marker_profile (papers.subject_id -> subjects.marker_profile) so
// the marker loads the right prompt overlay. Module-scope cached by paper id (a paper
// never changes subject in a warm instance). ANY failure or unknown profile falls back
// to the default (science) via overlayFor — it can never break a mark, only mark as science.
const markerProfileCache = new Map<string, string>();
async function resolveMarkerProfile(paper_id: string | undefined | null): Promise<string | null> {
  if (!sb || !paper_id) return null;
  if (markerProfileCache.has(paper_id)) return markerProfileCache.get(paper_id)!;
  try {
    const { data } = await sb.from("papers").select("subjects(marker_profile)").eq("id", paper_id).single();
    const mp = (data as { subjects?: { marker_profile?: string } } | null)?.subjects?.marker_profile;
    if (mp) { markerProfileCache.set(paper_id, mp); return mp; }
  } catch { /* fall through to default */ }
  return null;
}

// Hard cost backstop, identical in spirit to mark-answer: true when a school's
// AI-mark usage is >3x its fair-use allowance (school_mark_status RPC). The soft cap
// (admin Schools view) never blocks pupils; this only ever catches genuine
// runaway/abuse. Per-instance cached 5 min, and fails OPEN on any error so a transient
// DB issue never blocks real marking. Comped pilots / uncapped plans always return false.
const markBackstopCache = new Map<string, { over: boolean; ts: number }>();
async function overBackstop(school_id: string | null): Promise<boolean> {
  if (!sb || !school_id) return false;
  const hit = markBackstopCache.get(school_id);
  if (hit && (Date.now() - hit.ts) < 300000) return hit.over;
  try {
    const { data, error } = await sb.rpc("school_mark_status", { p_school_id: school_id });
    if (error) return false;
    const row = Array.isArray(data) ? data[0] : data;
    const over = !!(row && row.over_backstop);
    markBackstopCache.set(school_id, { over, ts: Date.now() });
    return over;
  } catch {
    return false;
  }
}

async function markWithAI(
  question: string,
  command_word: string,
  marks: number,
  marking_points: Array<{ text?: string; marks?: number }>,
  student_answer: string,
  overlay: string,
  context: { school_id: string | null; request_id: string },
) {
  const pointsList = marking_points
    .map((p, i) => `  ${i}. (${p.marks ?? 1} mark${(p.marks ?? 1) > 1 ? "s" : ""}) ${p.text ?? ""}`)
    .join("\n");
  const userMessage = `Question (${marks} mark${marks > 1 ? "s" : ""}, command word: ${command_word || "none"}):\n${question}\n\nMarking points:\n${pointsList}\n\nStudent's answer:\n${student_answer}\n\nMaximum marks awardable: ${marks}`;
  const result = await openAIResponse({
    model: MODEL,
    max_output_tokens: 320,
    instructions: `${BASE_PAPER}\n\n${overlay}`,
    input: userMessage,
    schema: PAPER_VERDICT_SCHEMA,
    schema_name: "paper_verdict",
    reasoning_effort: "minimal",
    prompt_cache_key: "paper-marker-v3",
  });
  const data = result.data;
  const event: UsageEvent = {
    call_label: "mark-paper", source: "ai", operation: "mark_paper",
    provider: AI_PROVIDER, model: MODEL, usage: data?.usage,
    latency_ms: result.latency_ms, success: result.ok,
  };
  if (!result.ok) {
    await logUsage(sb, event, context);
    throw new Error(`OpenAI ${result.status}`);
  }
  const clean = openAIResponseText(data);
  let parsed: { marks_awarded?: number; awarded_points?: unknown; feedback?: string; flagged?: boolean };
  try { parsed = decodePaperVerdict(JSON.parse(clean)); } catch (error) {
    event.success = false;
    await logUsage(sb, event, context);
    throw error;
  }
  const ma = Math.max(0, Math.min(Number(parsed.marks_awarded) || 0, Number(marks) || 1));
  const ap = Array.isArray(parsed.awarded_points) ? parsed.awarded_points.filter((n) => typeof n === "number" && n >= 0 && n < marking_points.length) : [];
  return { verdict: { marks_awarded: ma, awarded_points: ap, feedback: parsed.feedback || "", flagged: !!parsed.flagged }, event };
}

async function storedPaperVerdict(uid: string, request_id: string, response_id?: string | null) {
  if (!sb) return null;
  let query = sb.from("paper_responses")
    .select("id,attempt_id,paper_question_id,marks_awarded,awarded_points,ai_feedback,flagged,marking_source,paper_attempts!inner(student_id)")
    .eq("paper_attempts.student_id", uid);
  query = response_id ? query.eq("id", response_id) : query.eq("request_id", request_id);
  const { data, error } = await query.limit(1);
  if (error || !data?.length) return null;
  const row = data[0];
  return {
    marks_awarded: Number(row.marks_awarded) || 0,
    awarded_points: Array.isArray(row.awarded_points) ? row.awarded_points : [],
    feedback: row.ai_feedback || "",
    flagged: !!row.flagged,
    source: row.marking_source || "idempotent_replay",
    recorded: true,
    response_id: row.id,
    replayed: true,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let activeRequestId: string | null = null;
  try {
    const body = await req.json();
    const { attempt_id, paper_question_id, student_answer } = body;
    if (!student_answer) return json({ error: "Missing fields" }, 400);

    // ── AUTH IS REQUIRED to trigger a paid marking call ──
    // Past-paper marking costs money AND writes a grade, so this endpoint no longer
    // marks for an unauthenticated caller (the old "mark only, record nothing" path
    // was an open, unmetered AI cost sink). A valid pupil JWT is mandatory; the
    // question / marks / marking points are ALWAYS loaded from the DB — never trusted
    // from the client, so a cheat can neither inflate the marks nor balloon the token
    // volume with a fabricated marking-point list — and the attempt must be the
    // calling pupil's own.
    if (!sb) return json({ error: "Server not configured." }, 500);
    const uid = await getAuthedUid(req);
    if (!uid) return json({ error: "Sign in to submit an answer." }, 401);
    if (!attempt_id || !paper_question_id) {
      return json({ error: "attempt_id and paper_question_id are required" }, 400);
    }

    // The attempt must exist and belong to THIS pupil.
    const att = await sb.from("paper_attempts")
      .select("id, paper_id, class_id, student_id").eq("id", attempt_id).single();
    if (att.error || !att.data || att.data.student_id !== uid) {
      return json({ error: "Not your attempt." }, 403);
    }

    // Load the question authoritatively and confirm it belongs to the attempt's paper.
    const q = await sb.from("paper_questions")
      .select("paper_id, question_text, command_word, marks, marking_points")
      .eq("id", paper_question_id).single();
    if (q.error || !q.data || q.data.paper_id !== att.data.paper_id) {
      return json({ error: "Question does not belong to this attempt." }, 400);
    }
    const question = q.data.question_text as string;
    const command_word = q.data.command_word as string;
    const marks = Number(q.data.marks) || 1;
    const marking_points = Array.isArray(q.data.marking_points)
      ? q.data.marking_points as Array<{ text?: string; marks?: number }> : [];
    if (!question) return json({ error: "Question has no text." }, 400);

    const requestId = validRequestId(body?.request_id) || crypto.randomUUID();
    activeRequestId = requestId;
    const claim = await claimRequest(sb, requestId, uid, "mark_paper");
    if (!claim.claimed) {
      if (claim.status === "completed") {
        const prior = await storedPaperVerdict(uid, requestId, claim.response_id);
        if (prior) return json({ ...prior, request_id: requestId });
      }
      if (claim.status === "conflict") return json({ error: "request_id was already used for another operation" }, 409);
      return json({ error: "This answer is already being marked. Retry shortly.", request_id: requestId }, 409);
    }

    if (!OPENAI_API_KEY) {
      await finishRequest(sb, requestId, "failed");
      activeRequestId = null;
      return json({ marks_awarded: 0, awarded_points: [], feedback: "AI marking not configured.", flagged: false, source: "fallback", recorded: false, response_id: null });
    }

    // Hard cost backstop (same as mark-answer): a school >3x its fair-use allowance
    // skips the paid call and records nothing. Fails open; never catches normal use.
    const schoolId = await resolveSchoolId(att.data.class_id as string);
    if (await overBackstop(schoolId)) {
      await finishRequest(sb, requestId, "failed");
      activeRequestId = null;
      return json({ marks_awarded: 0, awarded_points: [], feedback: "Marking is paused for your school right now — please let your teacher know.", flagged: false, source: "cap_backstop", recorded: false, response_id: null });
    }

    const markerProfile = await resolveMarkerProfile(att.data.paper_id as string);
    const overlay = overlayFor(markerProfile, "paper");
    const marked = await markWithAI(question, command_word, marks, marking_points, student_answer, overlay, { school_id: schoolId, request_id: requestId });
    const verdict = marked.verdict;

    // Record server-side (authoritative): the attempt and question were already
    // verified above, so neither the marks nor the totals are ever client-supplied.
    let recorded = false;
    let response_id: string | null = null;
    const row = {
      attempt_id, paper_question_id, student_answer,
      marks_awarded: verdict.marks_awarded, marks_max: marks,
      ai_feedback: verdict.feedback, awarded_points: verdict.awarded_points, flagged: verdict.flagged,
      request_id: requestId, marking_source: "ai",
    };
    const existing = await sb.from("paper_responses").select("id").eq("attempt_id", attempt_id).eq("paper_question_id", paper_question_id).limit(1);
    if (!existing.error && existing.data && existing.data.length > 0) {
      await sb.from("paper_responses").update(row).eq("id", existing.data[0].id);
      response_id = existing.data[0].id as string;
      recorded = true;
    } else {
      const ins = await sb.from("paper_responses").insert(row).select("id").single();
      if (!ins.error && ins.data) { response_id = ins.data.id as string; recorded = true; }
    }
    // Recompute the attempt totals from the stored responses — authoritative.
    if (recorded) {
      const all = await sb.from("paper_responses").select("marks_awarded").eq("attempt_id", attempt_id);
      const awarded = (all.data || []).reduce((s, r) => s + (Number(r.marks_awarded) || 0), 0);
      const pq = await sb.from("paper_questions").select("marks").eq("paper_id", att.data.paper_id);
      const total = (pq.data || []).reduce((s, r) => s + (Number(r.marks) || 0), 0);
      await sb.from("paper_attempts").update({ awarded_marks: awarded, total_marks: total }).eq("id", attempt_id);
    }

    await logUsage(sb, marked.event, { school_id: schoolId, request_id: requestId, response_id });
    if (recorded) await finishRequest(sb, requestId, "completed", response_id);
    else await finishRequest(sb, requestId, "failed");
    activeRequestId = null;

    return json({ ...verdict, source: "ai", recorded, response_id, request_id: requestId });
  } catch (error) {
    if (sb && activeRequestId) await finishRequest(sb, activeRequestId, "failed");
    return json({ marks_awarded: 0, awarded_points: [], feedback: "Marking error — try again.", flagged: false, source: "error", recorded: false, response_id: null, error: String(error) }, 500);
  }
});
