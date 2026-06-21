import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_RETRIEVAL } from "../_shared/marking/base-retrieval.ts";
import { overlayFor } from "../_shared/marking/registry.ts";

/* mark-preview — ANONYMOUS, ungated retrieval marking for the public revision
 * booklets on interactive-science.com.
 *
 * The visitor's browser only ever has a question_id (from the anon-readable
 * topic_preview_questions RPC) — it never sees the model answer. This function
 * resolves the model answer SERVER-SIDE (service role), but ONLY for SHARED bank
 * questions, runs the SAME marking engine as mark-answer (BASE_RETRIEVAL +
 * per-subject overlay), and returns just the verdict. It deliberately differs
 * from mark-answer in three ways that keep an open, unauthenticated endpoint safe
 * and cheap:
 *   1. It only marks `shared = true` questions, so no teacher's private mark
 *      scheme is ever reachable through it.
 *   2. It NEVER records a response (anon practice isn't class-scoped — recording
 *      it would pollute teachers' gradebooks) and NEVER writes the answer cache
 *      (anon answers must not shape the authoritative cache). It only READS the
 *      cache, to serve popular answers without paying for AI.
 *   3. It is rate-limited per caller IP (anon_mark_bump) as a cost guard. The
 *      limiter FAILS OPEN — a missing/broken limiter never blocks a learner. */

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-haiku-4-5-20251001";

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

// Anonymous cost guard: max marks one IP can trigger per day. Overridable via env.
const ANON_DAILY_LIMIT = Number(Deno.env.get("ANON_MARK_DAILY_LIMIT")) || 30;
// Hard cap on the answer we'll send to the AI marker — bounds cost/abuse.
const MAX_ANSWER_LEN = 600;

// Cache safety thresholds — identical to mark-answer so a cached verdict served
// here matches what the authed app would serve.
const CONFIRMATION_THRESHOLD = 3;
const MAX_HITS_BEFORE_REVERIFY = 50;
const MAX_AGE_DAYS_BEFORE_REVERIFY = 90;

function extractNumbers(text: string): number[] {
  const matches = text.match(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g);
  return matches ? matches.map(Number) : [];
}

function checkNumericalMatch(modelAnswer: string, studentAnswer: string): boolean {
  const modelNums = extractNumbers(modelAnswer);
  if (modelNums.length !== 1) return false;
  const target = modelNums[0];
  return extractNumbers(studentAnswer).some(n => n === target);
}

function normalise(text: string): string {
  let t = (text || "").toLowerCase().trim();
  t = t.replace(/[.,;:!?\"“”‘’()\[\]{}\/\\]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^(the|a|an)\s+/, "");
  return t;
}

// Caller IP for the rate-limit bucket. x-forwarded-for is a comma list; first hop
// is the client. Falls back to a constant so an absent header still meters (shared
// bucket) rather than bypassing the cap.
function callerBucket(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

// Atomically bump + check the daily anonymous allowance. FAILS OPEN: any limiter
// error (missing migration, transient DB) returns "allowed" — a cost guard must
// never block a genuine learner.
async function withinAnonLimit(req: Request): Promise<boolean> {
  if (!sb) return true;
  try {
    const { data, error } = await sb.rpc("anon_mark_bump", { p_bucket: callerBucket(req), p_limit: ANON_DAILY_LIMIT });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

// Read-only cache lookup. Same authority/staleness rules as mark-answer, but this
// function never writes confirmations — anon answers must not shape the cache.
async function tryCacheLookup(question_id: string, normalised: string) {
  if (!sb || !question_id || !normalised) return null;
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
  } catch {
    return null;
  }
}

async function callAiMark(overlay: string, question: string, model_answer: string, student_answer: string, marks: number) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: [
        { type: "text", text: BASE_RETRIEVAL, cache_control: { type: "ephemeral" } },
        { type: "text", text: overlay, cache_control: { type: "ephemeral" } },
      ],
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Question (${marks} mark${marks > 1 ? "s" : ""}): ${question}\nModel answer: ${model_answer}`,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: `\nStudent wrote: ${student_answer}` },
        ],
      }],
    }),
  });
  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// Resolve a SHARED question's marking material server-side. Returns null if the
// question doesn't exist, is archived, or is NOT shared — so a private mark scheme
// is never reachable through this open endpoint.
async function resolveSharedQuestion(question_id: string) {
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("questions")
      .select("question_text, model_answer, marks, shared, archived, topics(subjects(marker_profile))")
      .eq("id", question_id)
      .single();
    if (error || !data || data.shared !== true || data.archived === true) return null;
    const profile = (data as { topics?: { subjects?: { marker_profile?: string } } }).topics?.subjects?.marker_profile ?? null;
    return {
      question: data.question_text as string,
      model_answer: data.model_answer as string,
      marks: Number(data.marks) || 1,
      marker_profile: profile,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { question_id, student_answer } = await req.json();

    if (!question_id || typeof student_answer !== "string" || !student_answer.trim()) {
      return json({ error: "Missing question_id or student_answer" }, 400);
    }
    const answer = student_answer.trim().slice(0, MAX_ANSWER_LEN);

    // Cost guard (fails open).
    if (!(await withinAnonLimit(req))) {
      return json({ error: "limit", feedback: "That's all the free practice for now — sign in to keep going.", source: "anon_limit" }, 429);
    }

    const q = await resolveSharedQuestion(question_id);
    if (!q) return json({ error: "Question not available" }, 404);

    const maxMarks = q.marks;
    let verdict: { correct: boolean; marks_awarded: number; feedback: string; flagged: boolean; source: string };

    if (checkNumericalMatch(q.model_answer, answer)) {
      verdict = { correct: true, marks_awarded: maxMarks, feedback: "Correct.", flagged: false, source: "numerical_match" };
    } else if (normalise(answer) === normalise(q.model_answer)) {
      verdict = { correct: true, marks_awarded: maxMarks, feedback: "Correct.", flagged: false, source: "exact_match" };
    } else {
      const normalised = normalise(answer);
      const cached = await tryCacheLookup(question_id, normalised);
      if (cached) {
        verdict = { correct: true, marks_awarded: cached.marks_awarded, feedback: cached.feedback || "Correct.", flagged: false, source: "cache" };
      } else if (!ANTHROPIC_API_KEY) {
        verdict = { correct: false, marks_awarded: 0, feedback: "Marking unavailable right now.", flagged: false, source: "fallback" };
      } else {
        const overlay = overlayFor(q.marker_profile, "retrieval");
        const first = await callAiMark(overlay, q.question, q.model_answer, answer, maxMarks);
        if (first.correct || first.flagged) {
          verdict = { correct: !!first.correct, marks_awarded: first.marks_awarded ?? (first.correct ? maxMarks : 0), feedback: first.feedback || "", flagged: !!first.flagged, source: "ai" };
        } else {
          // Double-check only non-high-confidence wrongs — same lever as mark-answer:
          // a confidently-wrong verdict is rarely overturned, so don't pay for it.
          let overturned: { correct?: boolean; marks_awarded?: number; feedback?: string } | null = null;
          if (first.confidence !== "high") {
            try {
              const second = await callAiMark(overlay, q.question, q.model_answer, answer, maxMarks);
              if (second.correct) overturned = second;
            } catch { /* keep the confirmed-wrong verdict */ }
          }
          verdict = overturned
            ? { correct: true, marks_awarded: overturned.marks_awarded ?? maxMarks, feedback: overturned.feedback || "", flagged: false, source: "ai_double_check_overturned" }
            : { correct: false, marks_awarded: first.marks_awarded ?? 0, feedback: first.feedback || "", flagged: !!first.flagged, source: "ai" };
        }
      }
    }

    // Clamp to [0, maxMarks].
    let awarded = Number(verdict.marks_awarded);
    if (!Number.isFinite(awarded)) awarded = verdict.correct ? maxMarks : 0;
    verdict.marks_awarded = Math.max(0, Math.min(maxMarks, Math.round(awarded)));

    // Return ONLY the verdict — never the model answer, never a response_id.
    return json({
      correct: verdict.correct,
      marks_awarded: verdict.marks_awarded,
      max_marks: maxMarks,
      feedback: verdict.feedback,
      flagged: verdict.flagged,
      source: verdict.source,
    });
  } catch (error) {
    return json({ correct: false, marks_awarded: 0, feedback: "Marking error — try again.", flagged: false, source: "error", error: String(error) }, 500);
  }
});
