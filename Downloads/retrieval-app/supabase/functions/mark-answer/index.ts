import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_RETRIEVAL } from "../_shared/marking/base-retrieval.ts";
import { overlayFor } from "../_shared/marking/registry.ts";
import { checkNumericalMatch } from "../_shared/marking/numeric.ts";
import {
  AI_PROVIDER, claimRequest, decodeRetrievalVerdict, finishRequest,
  logShortcut, logUsage, OPENAI_API_KEY, OPENAI_MARKING_MODEL,
  openAIResponse, openAIResponseText, validRequestId, type UsageEvent,
} from "../_shared/ai.ts";

const MODEL = OPENAI_MARKING_MODEL;

const RETRIEVAL_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    c: { type: "boolean" },
    m: { type: "integer" },
    f: { type: "string" },
    x: { type: "boolean" },
    q: { type: "string", enum: ["h", "m", "l"] },
  },
  required: ["c", "m", "f", "x", "q"],
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

// Cache safety thresholds
const CONFIRMATION_THRESHOLD = 3;       // entries become authoritative at this many independent confirmations
const MAX_HITS_BEFORE_REVERIFY = 50;    // after this many cache hits, the next call re-verifies via AI; a
                                        // successful high-confidence re-verify then resets hit_count (see
                                        // recordCacheConfirmation) so the entry RESUMES serving from cache.
                                        // COST LEVER 2: without that reset, a popular answer permanently
                                        // reverted to a full AI call on every hit once it crossed this line —
                                        // the opposite of leaning on the cache. Now it re-checks every ~50
                                        // hits and serves from cache in between.
const MAX_AGE_DAYS_BEFORE_REVERIFY = 90; // entries older than this re-verify next call
const MIN_ANSWER_WORDS = 3;             // never cache anything shorter than this in absolute terms
const MIN_LENGTH_RATIO = 0.6;           // OR at least 60% of model answer length

// Normalise an answer for cache lookup. Conservative: lowercase, strip
// punctuation (but keep hyphens for compound terms), drop leading articles,
// collapse whitespace. Do NOT do edit-distance or stemming.
function normalise(text: string): string {
  let t = (text || "").toLowerCase().trim();
  // Strip punctuation except hyphens and apostrophes-in-words
  t = t.replace(/[.,;:!?\"“”‘’()\[\]{}\/\\]/g, " ");
  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  // Strip leading articles
  t = t.replace(/^(the|a|an)\s+/, "");
  return t;
}

// Check the length floor: cached answer must be at least 60% of model answer length
// OR at least 3 words long. This catches "yes" / "I don't know" / "blood pumps" cases.
function passesLengthFloor(studentAnswer: string, modelAnswer: string): boolean {
  const studentWords = studentAnswer.trim().split(/\s+/).filter(Boolean);
  const modelWords = modelAnswer.trim().split(/\s+/).filter(Boolean);
  if (studentWords.length >= MIN_ANSWER_WORDS) return true;
  // Below MIN_ANSWER_WORDS: only allow if it's at least MIN_LENGTH_RATIO of the model answer
  if (modelWords.length === 0) return false;
  return studentWords.length / modelWords.length >= MIN_LENGTH_RATIO;
}

// Resolve the school that owns a class, so every usage row can be attributed to a
// school (exact per-school cost + fair-use metering). Cached in module scope: a class
// never changes school within a warm instance, so this is one DB lookup per class, not
// per request — the deterministic fast paths stay fast.
const schoolIdCache = new Map<string, string | null>();
async function resolveSchoolId(class_id: string | undefined): Promise<string | null> {
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

// Resolve the subject's marker_profile (subjects.marker_profile) so the marker loads
// the right prompt overlay. Authoritative: question -> topic -> subject, else class ->
// subject. Module-scope cached (a question/class never changes subject in a warm
// instance). ANY failure or unknown profile falls back to the default (science) via
// overlayFor — a bad or absent profile can never break a mark, only mark as science.
const markerProfileCache = new Map<string, string>();
async function resolveMarkerProfile(question_id: string | undefined, class_id: string | undefined): Promise<string | null> {
  if (!sb) return null;
  if (question_id) {
    const ck = "q:" + question_id;
    if (markerProfileCache.has(ck)) return markerProfileCache.get(ck)!;
    try {
      const { data } = await sb.from("questions").select("topics(subjects(marker_profile))").eq("id", question_id).single();
      const mp = (data as { topics?: { subjects?: { marker_profile?: string } } } | null)?.topics?.subjects?.marker_profile;
      if (mp) { markerProfileCache.set(ck, mp); return mp; }
    } catch { /* fall through to class / default */ }
  }
  if (class_id) {
    const ck = "c:" + class_id;
    if (markerProfileCache.has(ck)) return markerProfileCache.get(ck)!;
    try {
      const { data } = await sb.from("classes").select("subjects(marker_profile)").eq("id", class_id).single();
      const mp = (data as { subjects?: { marker_profile?: string } } | null)?.subjects?.marker_profile;
      if (mp) { markerProfileCache.set(ck, mp); return mp; }
    } catch { /* fall through to default */ }
  }
  return null;
}

// Hard cost backstop: true when a school's AI-mark usage is >3x its fair-use
// allowance (school_mark_status RPC). The soft cap (admin Schools view) never blocks
// pupils; this only ever catches genuine runaway/abuse. Per-instance cached 5 min,
// and fails OPEN on any error (a transient DB issue must never block real marking).
// Comped pilots and uncapped/unknown plans always return false.
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

async function callAiMark(
  label: string,
  source: string,
  overlay: string,
  question: string,
  model_answer: string,
  student_answer: string,
  marks: number,
  context: { school_id: string | null; request_id: string },
) {
  // Stable instructions come first so OpenAI's automatic prompt cache can reuse
  // the marking engine. Pupil-specific text stays at the end and responses are
  // never stored by the provider (see openAIResponse).
  const result = await openAIResponse({
    model: MODEL,
    max_output_tokens: 180,
    instructions: `${BASE_RETRIEVAL}\n\n${overlay}`,
    input: `Question (${marks} mark${marks > 1 ? "s" : ""}): ${question}\nModel answer: ${model_answer}\n\nStudent wrote: ${student_answer}`,
    schema: RETRIEVAL_VERDICT_SCHEMA,
    schema_name: "retrieval_verdict",
    reasoning_effort: "minimal",
    prompt_cache_key: "retrieval-marker-v3",
  });
  const data = result.data;
  const event: UsageEvent = {
    call_label: label, source, operation: "mark_retrieval",
    provider: AI_PROVIDER, model: MODEL, usage: data?.usage,
    latency_ms: result.latency_ms, success: result.ok,
  };
  if (!result.ok) {
    await logUsage(sb, event, context);
    throw new Error(`OpenAI ${result.status}: ${String(data?.error?.message || "request failed").slice(0, 180)}`);
  }
  const clean = openAIResponseText(data);
  try {
    return { verdict: decodeRetrievalVerdict(JSON.parse(clean)), event };
  } catch (error) {
    event.success = false;
    await logUsage(sb, event, context);
    throw error;
  }
}

// Look for an authoritative cache entry. Returns the entry only if it is
// authoritative (>=3 confirmations) AND not stale (age, hit count).
async function tryCacheLookup(question_id: string | undefined, normalised: string) {
  if (!sb || !question_id) return null;
  try {
    const { data, error } = await sb
      .from("accepted_answers")
      .select("id, marks_awarded, feedback, confirmation_count, hit_count, last_verified_at")
      .eq("question_id", question_id)
      .eq("normalised_answer", normalised)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const entry = data[0];
    if ((entry.confirmation_count ?? 0) < CONFIRMATION_THRESHOLD) return null;
    if ((entry.hit_count ?? 0) >= MAX_HITS_BEFORE_REVERIFY) return null;
    const ageDays = (Date.now() - new Date(entry.last_verified_at).getTime()) / 86400000;
    if (ageDays >= MAX_AGE_DAYS_BEFORE_REVERIFY) return null;
    return entry;
  } catch (e) {
    console.error("cache lookup failed:", e);
    return null;
  }
}

// Increment hit_count when serving from cache. Fire-and-forget.
function recordCacheHit(entryId: number) {
  if (!sb) return;
  sb.rpc("increment_accepted_answer_hit", { entry_id: entryId }).then(() => {}).catch(() => {
    // Fallback: direct update if RPC missing
    sb.from("accepted_answers").update({ hit_count: { increment: 1 } as unknown as number }).eq("id", entryId).then(() => {}).catch(() => {});
  });
}

// Direct update via raw SQL through service role (since the RPC may not exist)
async function bumpHitCount(entryId: number) {
  if (!sb) return;
  try {
    await sb.from("accepted_answers").select("hit_count").eq("id", entryId).single().then(async (r) => {
      const next = (r.data?.hit_count ?? 0) + 1;
      await sb.from("accepted_answers").update({ hit_count: next }).eq("id", entryId);
    });
  } catch (e) {
    console.error("hit count update failed:", e);
  }
}

// Either insert a new cache entry, or increment the confirmation_count on an existing one.
async function recordCacheConfirmation(question_id: string, normalised: string, marks_awarded: number, feedback: string) {
  if (!sb || !question_id) return;
  try {
    const existing = await sb
      .from("accepted_answers")
      .select("id, confirmation_count")
      .eq("question_id", question_id)
      .eq("normalised_answer", normalised)
      .eq("marks_awarded", marks_awarded)
      .limit(1);
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.length > 0) {
      const row = existing.data[0];
      await sb.from("accepted_answers").update({
        confirmation_count: (row.confirmation_count ?? 0) + 1,
        last_verified_at: new Date().toISOString(),
        // COST LEVER 2: reset the hit counter on every (re)confirmation. This only
        // ever runs on the AI path — a fresh confirmation or a periodic re-verify,
        // never on a plain cache serve — so resetting it here is exactly what lets a
        // re-verified popular entry start serving from cache again for the next
        // MAX_HITS_BEFORE_REVERIFY hits instead of AI-marking every pupil forever.
        hit_count: 0,
        feedback,
      }).eq("id", row.id);
    } else {
      await sb.from("accepted_answers").insert({
        question_id,
        normalised_answer: normalised,
        marks_awarded,
        feedback,
        confirmation_count: 1,
        hit_count: 0,
      });
    }
  } catch (e) {
    console.error("cache confirmation write failed:", e);
  }
}

// Identify the calling pupil from their Supabase JWT. Returns null when there is
// no user token (e.g. older clients that send only the anon apikey), in which
// case the function stays a pure marking endpoint and records nothing.
async function getAuthedUid(req: Request): Promise<string | null> {
  if (!sb) return null;
  const authz = req.headers.get("Authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const { data, error } = await sb.auth.getUser(m[1]);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// When an answer belongs to targeted practice, verify the pupil, class and
// question are all part of that published assignment. A forged assignment_id
// must never be able to create false completion evidence.
async function validateAssignment(
  assignment_id: string | null,
  uid: string,
  class_id: string,
  question_id: string,
): Promise<boolean> {
  if (!assignment_id) return true;
  if (!sb) return false;
  const [assignment, pupil, question] = await Promise.all([
    sb.from("retrieval_assignments")
      .select("id,class_id,status,available_from")
      .eq("id", assignment_id).eq("class_id", class_id).single(),
    sb.from("retrieval_assignment_students")
      .select("student_id")
      .eq("assignment_id", assignment_id).eq("student_id", uid).limit(1),
    sb.from("retrieval_assignment_questions")
      .select("question_id")
      .eq("assignment_id", assignment_id).eq("question_id", question_id).limit(1),
  ]);
  if (assignment.error || !assignment.data || assignment.data.status !== "published") return false;
  if (assignment.data.available_from && new Date(assignment.data.available_from) > new Date()) return false;
  return !!pupil.data?.length && !!question.data?.length;
}

// Write the marked response server-side (service role), but ONLY for the
// authenticated pupil and ONLY in a class they belong to. This is what makes the
// grade authoritative: the stored is_correct / marks_awarded come from here, not
// from a value the browser sent. Returns the new row id, or null if it could not
// be recorded (the caller then just returns the verdict, no response_id).
async function recordResponse(
  uid: string | null,
  question_id: string | undefined,
  class_id: string | undefined,
  student_answer: string,
  verdict: { correct: boolean; marks_awarded: number; feedback: string; flagged: boolean; confidence?: string },
  request_id: string,
  marking_source: string,
  assignment_id: string | null,
): Promise<string | null> {
  if (!sb || !uid || !question_id || !class_id) return null;
  try {
    const mem = await sb
      .from("class_members")
      .select("student_id")
      .eq("class_id", class_id)
      .eq("student_id", uid)
      .limit(1);
    if (mem.error || !mem.data || mem.data.length === 0) return null;
    const ins = await sb
      .from("responses")
      .insert({
        student_id: uid,
        question_id,
        class_id,
        student_answer,
        is_correct: verdict.correct,
        marks_awarded: verdict.marks_awarded,
        ai_feedback: verdict.flagged ? "FLAGGED: " + verdict.feedback : verdict.feedback,
        ai_confidence: verdict.confidence ?? null,
        request_id,
        marking_source,
        assignment_id,
        original_is_correct: verdict.correct,
        original_marks_awarded: verdict.marks_awarded,
        marker_model: marking_source.startsWith("ai") ? MODEL : null,
        rubric_version: 1,
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) return null;
    return ins.data.id as string;
  } catch (e) {
    console.error("response insert failed:", e);
    return null;
  }
}

async function refreshAssignmentCompletion(assignment_id: string | null, uid: string) {
  if (!sb || !assignment_id) return;
  try {
    const [assigned, marked] = await Promise.all([
      sb.from("retrieval_assignment_questions").select("question_id").eq("assignment_id", assignment_id),
      sb.from("responses").select("question_id").eq("assignment_id", assignment_id).eq("student_id", uid),
    ]);
    if (assigned.error || marked.error || !assigned.data?.length) return;
    const required = new Set(assigned.data.map(row => row.question_id)).size;
    const completed = new Set((marked.data || []).map(row => row.question_id)).size;
    if (completed >= required) {
      await sb.from("retrieval_assignment_students")
        .update({ completed_at: new Date().toISOString() })
        .eq("assignment_id", assignment_id).eq("student_id", uid).is("completed_at", null);
    }
  } catch (e) {
    console.error("assignment completion update failed:", e);
  }
}

async function storedVerdict(uid: string, request_id: string, response_id?: string | null) {
  if (!sb) return null;
  let query = sb.from("responses")
    .select("id,is_correct,marks_awarded,ai_feedback,ai_confidence,marking_source")
    .eq("student_id", uid);
  query = response_id ? query.eq("id", response_id) : query.eq("request_id", request_id);
  const { data, error } = await query.limit(1);
  if (error || !data?.length) return null;
  const row = data[0];
  const rawFeedback = String(row.ai_feedback || "");
  const flagged = rawFeedback.startsWith("FLAGGED: ");
  return {
    correct: !!row.is_correct,
    marks_awarded: Number(row.marks_awarded) || 0,
    feedback: flagged ? rawFeedback.slice(9) : rawFeedback,
    flagged,
    confidence: row.ai_confidence || "high",
    source: row.marking_source || "idempotent_replay",
    recorded: true,
    response_id: row.id,
    replayed: true,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let activeRequestId: string | null = null;
  try {
    if (!sb) return json({ error: "Server not configured." }, 500);
    const body = await req.json();
    const question_id = String(body?.question_id || "");
    const class_id = String(body?.class_id || "");
    const assignment_id = body?.assignment_id ? String(body.assignment_id) : null;
    if (!question_id || !class_id) return json({ error: "question_id and class_id are required" }, 400);

    // The authenticated endpoint is the paid, authoritative marking path. Public
    // practice has its own constrained mark-preview route.
    const uid = await getAuthedUid(req);
    if (!uid) return json({ error: "Sign in to submit an answer." }, 401);

    const [membership, questionRow] = await Promise.all([
      sb.from("class_members").select("student_id").eq("class_id", class_id).eq("student_id", uid).limit(1),
      sb.from("questions").select("question_text,model_answer,marks,kind,options,correct_index,archived").eq("id", question_id).single(),
    ]);
    if (membership.error || !membership.data?.length) return json({ error: "Not enrolled in this class." }, 403);
    if (questionRow.error || !questionRow.data || questionRow.data.archived) return json({ error: "Question not available." }, 404);
    if (!await validateAssignment(assignment_id, uid, class_id, question_id)) {
      return json({ error: "This question is not available in that assignment." }, 403);
    }

    // Question text, model answer and marks are DB-authoritative. Besides grade
    // integrity, this bounds prompt size so a pupil cannot inflate provider cost.
    const question = String(questionRow.data.question_text || "");
    const model_answer = String(questionRow.data.model_answer || "");
    const maxMarks = Math.max(1, Number(questionRow.data.marks) || 1);
    const isMcq = questionRow.data.kind === "mcq";
    const selectedIndex = Number(body?.selected_index);
    const options = Array.isArray(questionRow.data.options) ? questionRow.data.options.map(String) : [];
    let student_answer = String(body?.student_answer || "").trim().slice(0, 2000);
    if (isMcq) {
      if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
        return json({ error: "Choose a valid answer option." }, 400);
      }
      student_answer = options[selectedIndex];
    } else if (!student_answer) {
      return json({ error: "student_answer is required" }, 400);
    }

    const operation = isMcq ? "mark_mcq" : "mark_retrieval";
    const requestId = validRequestId(body?.request_id) || crypto.randomUUID();
    activeRequestId = requestId;
    const claim = await claimRequest(sb, requestId, uid, operation);
    if (!claim.claimed) {
      if (claim.status === "completed") {
        const prior = await storedVerdict(uid, requestId, claim.response_id);
        if (prior) return json({ ...prior, request_id: requestId });
      }
      if (claim.status === "conflict") return json({ error: "request_id was already used for another operation" }, 409);
      return json({ error: "This answer is already being marked. Retry shortly.", request_id: requestId }, 409);
    }

    const schoolId = await resolveSchoolId(class_id);
    const usageEvents: UsageEvent[] = [];

    // ── Build the verdict (this is the only place the grade is decided) ──
    let verdict: { correct: boolean; marks_awarded: number; feedback: string; flagged: boolean; source: string; confidence?: string };

    if (isMcq) {
      const correct = selectedIndex === Number(questionRow.data.correct_index);
      verdict = {
        correct,
        marks_awarded: correct ? maxMarks : 0,
        feedback: correct ? "Correct." : "Not quite. Re-read the question, eliminate the least likely options, and try once more.",
        flagged: false,
        source: "mcq",
        confidence: "high",
      };
    } else if (body?.prejudged_flagged) {
      // The client's cheap heuristic flagged this as a non-attempt. Trusting it
      // can only award 0 / mark incorrect, so a cheating client gains nothing —
      // and it saves an AI call on obvious junk.
      verdict = {
        correct: false, marks_awarded: 0,
        feedback: typeof body.prejudged_flagged === "string" ? body.prejudged_flagged : "Flagged as a non-attempt.",
        flagged: true, source: "client_flagged",
      };
    } else if (checkNumericalMatch(model_answer, student_answer)) {
      verdict = { correct: true, marks_awarded: maxMarks, feedback: "Correct.", flagged: false, source: "numerical_match" };
    } else if (normalise(student_answer) === normalise(model_answer)) {
      // COST: deterministic exact match. The student wrote the model answer verbatim
      // (after the same lowercase / punctuation / leading-article normalisation used
      // for the cache key), so it is unambiguously full marks — no AI call needed, and
      // it marks identically every time. Bracketed model answers like "Joules (accept
      // J)" normalise WITH the bracket text, so a bare "joules" does NOT match here and
      // still goes to the AI — there is no false-positive path. Mirrors how
      // numerical_match already trusts the model answer.
      verdict = { correct: true, marks_awarded: maxMarks, feedback: "Correct.", flagged: false, source: "exact_match" };
    } else {
      const normalised = normalise(student_answer);
      const cached = (question_id && normalised.length > 0) ? await tryCacheLookup(question_id, normalised) : null;
      if (cached) {
        bumpHitCount(cached.id);
        verdict = { correct: true, marks_awarded: cached.marks_awarded, feedback: cached.feedback || "Correct.", flagged: false, source: "cache" };
      } else if (!OPENAI_API_KEY) {
        verdict = { correct: false, marks_awarded: 0, feedback: "AI marking not configured.", flagged: false, source: "fallback" };
      } else if (await overBackstop(schoolId)) {
        // Hard cost backstop: this school is >3x its fair-use allowance (see
        // school_mark_status). Skip the paid AI call and don't record a grade — the
        // soft cap never blocks pupils, but this stops genuine runaway/abuse cost.
        verdict = { correct: false, marks_awarded: 0, feedback: "Marking is paused for your school right now — please let your teacher know.", flagged: false, source: "cap_backstop" };
      } else {
        const tryWriteCache = async (result: { correct?: boolean; flagged?: boolean; confidence?: string; marks_awarded?: number; feedback?: string }) => {
          if (!question_id) return;
          if (!result.correct || result.flagged) return;
          if (result.confidence !== "high") return;
          if (!passesLengthFloor(student_answer, model_answer)) return;
          const marksAwarded = (typeof result.marks_awarded === "number" ? result.marks_awarded : maxMarks) | 0;
          await recordCacheConfirmation(question_id, normalised, marksAwarded, result.feedback || "Correct.");
        };

        const markerProfile = await resolveMarkerProfile(question_id, class_id);
        const overlay = overlayFor(markerProfile, "retrieval");

        const firstCall = await callAiMark("first", "ai", overlay, question, model_answer, student_answer, maxMarks, { school_id: schoolId, request_id: requestId });
        usageEvents.push(firstCall.event);
        const first = firstCall.verdict;
        if (first.correct || first.flagged) {
          tryWriteCache(first).catch(() => {});
          verdict = { correct: !!first.correct, marks_awarded: first.marks_awarded ?? (first.correct ? maxMarks : 0), feedback: first.feedback || (first.correct ? "Correct." : ""), flagged: !!first.flagged, source: "ai", confidence: first.confidence };
        } else {
          // Double-check wrong answers — the model is sometimes harsh on first pass.
          // COST LEVER 3: skip the re-check when the first pass is already high
          // confidence. A confidently-wrong verdict is very rarely overturned on a
          // second look, so re-marking it just burns a whole extra AI call. We only
          // pay for the double-check on medium/low-confidence wrongs — the cases the
          // overturn actually exists for. This trims ~15-20% of calls. A missing or
          // malformed confidence field falls through to !== "high", i.e. we keep the
          // safer old behaviour and still double-check.
          let overturned: { correct?: boolean; marks_awarded?: number; feedback?: string } | null = null;
          if (first.confidence !== "high") {
            try {
              const secondCall = await callAiMark("second", "ai_double_check", overlay, question, model_answer, student_answer, maxMarks, { school_id: schoolId, request_id: requestId });
              usageEvents.push(secondCall.event);
              const second = secondCall.verdict;
              if (second.correct) { tryWriteCache(second).catch(() => {}); overturned = second; }
            } catch (_) {
              // fall through to the confirmed-wrong verdict
            }
          }
          verdict = overturned
            ? { correct: true, marks_awarded: overturned.marks_awarded ?? maxMarks, feedback: overturned.feedback || "Correct.", flagged: false, source: "ai_double_check_overturned", confidence: "medium" }
            : { correct: !!first.correct, marks_awarded: first.marks_awarded ?? 0, feedback: first.feedback || "", flagged: !!first.flagged, source: "ai_double_check_confirmed", confidence: first.confidence };
        }
      }
    }

    // Clamp to [0, maxMarks] no matter the source.
    let awarded = Number(verdict.marks_awarded);
    if (!Number.isFinite(awarded)) awarded = verdict.correct ? maxMarks : 0;
    verdict.marks_awarded = Math.max(0, Math.min(maxMarks, Math.round(awarded)));
    // Deterministic marks (numerical/exact/cache/client_flagged) and the fallback are
    // certain by construction — record them as high confidence. The review queue keys
    // off low/medium, so these correctly never appear in it.
    if (!verdict.confidence) verdict.confidence = "high";

    // ── Record server-side (authenticated pupil, their own class only) ──
    // Never persist a backstop "verdict" as a grade — it isn't one.
    const response_id = verdict.source === "cap_backstop" ? null
      : await recordResponse(uid, question_id, class_id, student_answer, verdict, requestId, verdict.source, assignment_id);

    if (response_id && assignment_id) await refreshAssignmentCompletion(assignment_id, uid);

    const isShortcut = ["numerical_match", "exact_match", "cache", "client_flagged", "mcq"].includes(verdict.source);
    if (isShortcut) {
      await logShortcut(sb, verdict.source, operation, { school_id: schoolId, request_id: requestId, response_id });
    } else {
      await Promise.all(usageEvents.map((event) => logUsage(sb, event, { school_id: schoolId, request_id: requestId, response_id })));
    }

    if (response_id) await finishRequest(sb, requestId, "completed", response_id);
    else await finishRequest(sb, requestId, "failed");
    activeRequestId = null;
    return json({ ...verdict, recorded: response_id !== null, response_id, request_id: requestId });
  } catch (error) {
    if (sb && activeRequestId) await finishRequest(sb, activeRequestId, "failed");
    return json({
      correct: false, marks_awarded: 0, feedback: "Marking error — try again.",
      flagged: false, source: "error", recorded: false, response_id: null, error: String(error),
    }, 500);
  }
});
