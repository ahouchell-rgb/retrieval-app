// Class misconception miner — clusters a class's WRONG retrieval answers into
// named, SPECIFIC misconceptions for the teacher. This is the "close the loop"
// step: retrieval marking data -> actionable teaching insight -> reteach.
//
// POST /functions/v1/class-misconceptions
// Body:    { class_id, topic_id?, days? = 28 }
// Headers: Authorization: Bearer <teacher JWT>
// Returns: { misconceptions: [...], computed_at, model }  (or { error })
//
// Privacy: only the wrong-answer TEXT + aggregate counts are sent to the model —
// never pupil names or ids (the rollup RPC returns no identifiers). Anthropic is
// already the marking sub-processor (mark-answer sends the same text), so this
// introduces no new data flow. The raw result is cached in class_misconception_runs
// so re-opening the panel is free.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { AI_PROVIDER, logUsage, requestHash, type UsageEvent } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Teacher-facing analysis tier (matches the Feynman content routes: chat /
// feedforward / deck-to-questions). Insight quality matters here and call volume
// is low (a teacher clicks occasionally), so Sonnet over Haiku. Bump to
// "claude-opus-4-8" if you want deeper clustering — one-line change.
const MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1800;
const MAX_QUESTIONS = 24;          // cap prompt size / cost — the weakest questions first

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are an experienced UK secondary science teacher (AQA, KS3/GCSE) reviewing your class's WRONG answers to short retrieval-practice questions. Your job is to surface the few SPECIFIC misconceptions behind the mistakes — the faulty idea the pupils actually hold — not to restate that they got it wrong.

You are given a list of questions. For each: the question, its model answer, how many pupils got it wrong, and a sample of their real wrong answers (verbatim, anonymised).

Cluster these into the most common, specific misconceptions across the class. A good misconception is a single faulty idea you could address with one teaching move, e.g. "Confuses displacement with distance", "Thinks heavier objects fall faster", "Gives the word equation when asked for symbols". Avoid vague clusters like "doesn't understand forces".

RULES:
- Only include a misconception if at least 2 pupils show the SAME faulty idea. Ignore one-off slips, blanks, and obvious typos.
- Be specific to the science and grounded in the wrong answers you were actually given — quote a real example.
- Rank by how many pupils are affected, most first. Return at most 5.
- "fix" is one concrete teaching move or the correct idea to reteach, in a single sentence.
- British spelling. Keep every field tight.

Respond with ONLY a JSON object — no prose, no backticks:
{"misconceptions":[{"title":"<=8 words naming the specific confusion","topic_name":"the topic it sits in","pupils":<int>,"explanation":"1-2 sentences: the faulty reasoning these wrong answers reveal","example_wrong":"one representative wrong answer, verbatim","fix":"1 sentence: the teaching move / correct idea to reteach","question_ids":["<ids of the questions this shows up in>"]}]}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!ANTHROPIC_API_KEY) return json({ error: "AI marking is not configured." }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Auth: teacher JWT → user ───────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in." }, 401);
  const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.slice(7));
  if (authErr || !user) return json({ error: "Invalid or expired session." }, 401);

  const { data: profile } = await sb.from("profiles").select("role, school_id").eq("id", user.id).single();
  const role = profile?.role;
  if (!profile || !["teacher", "hod", "moderator", "admin"].includes(role)) {
    return json({ error: "Only staff can view misconceptions." }, 403);
  }

  let body: { class_id?: string; topic_id?: string | null; days?: number };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const class_id = body?.class_id;
  const topic_id = body?.topic_id || null;
  const days = Math.min(Math.max(Number(body?.days) || 28, 7), 180);
  if (!class_id) return json({ error: "class_id is required" }, 400);

  // ── Tenancy: caller must teach this class (moderator/admin bypass) ──────────
  const isPriv = role === "moderator" || role === "admin";
  const { data: cls } = await sb.from("classes").select("teacher_id, school_id").eq("id", class_id).single();
  if (!cls) return json({ error: "Class not found." }, 404);
  if (!isPriv && cls.teacher_id !== user.id) {
    return json({ error: "You can only view your own classes." }, 403);
  }
  const schoolId = cls.school_id ?? profile.school_id ?? null;

  // ── Read the wrong-answer rollup (no pupil identifiers) ─────────────────────
  const { data: rows, error: inErr } = await sb.rpc("class_misconception_inputs", {
    p_class_id: class_id, p_days: days, p_topic_id: topic_id,
  });
  if (inErr) return json({ error: `Could not load answers: ${inErr.message}` }, 500);
  const inputs = (rows || []).slice(0, MAX_QUESTIONS);
  if (inputs.length === 0) {
    return json({ misconceptions: [], note: "Not enough marked wrong answers yet to spot a pattern.", computed_at: new Date().toISOString() });
  }

  // ── Build the anonymised prompt ─────────────────────────────────────────────
  const dataText = inputs.map((q: any, n: number) =>
    `Q${n + 1} [id:${q.question_id}] (${q.marks} mark${q.marks > 1 ? "s" : ""}, topic: ${q.topic_name}) — ${q.wrong_pupils} pupil${q.wrong_pupils > 1 ? "s" : ""} got it wrong\n` +
    `Question: ${q.question_text}\nModel answer: ${q.model_answer}\n` +
    `Wrong answers pupils gave: ${(q.sample_wrong || []).map((s: string) => `"${s}"`).join("; ")}`
  ).join("\n\n");

  const hash = await requestHash({ operation: "class_misconceptions", version: 2, model: MODEL, class_id, topic_id, days, dataText });
  const prior = await sb.from("class_misconception_runs")
    .select("result,computed_at,model").eq("request_hash", hash).limit(1);
  if (!prior.error && prior.data?.length) {
    return json({ ...(prior.data[0].result || { misconceptions: [] }), computed_at: prior.data[0].computed_at, model: prior.data[0].model, cached: true });
  }

  // ── Cluster with Claude ─────────────────────────────────────────────────────
  let data: any;
  const requestId = crypto.randomUUID();
  const started = performance.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Default 5-minute cache: identical inputs are now stored by hash, so paying
        // the higher 1-hour cache-write premium no longer buys useful reuse.
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Class wrong-answer data (last ${days} days):\n\n${dataText}\n\nReturn the JSON now.` }],
      }),
    });
    data = await res.json();
    const event: UsageEvent = {
      call_label: "misconceptions", source: "ai", operation: "class_misconceptions",
      provider: AI_PROVIDER, model: MODEL, usage: data?.usage,
      latency_ms: performance.now() - started, success: res.ok,
    };
    await logUsage(sb, event, { school_id: schoolId, request_id: requestId });
    if (!res.ok) return json({ error: `Claude ${res.status}: ${String(data?.error?.message || "").slice(0, 200)}` }, 502);
  } catch (e) {
    await logUsage(sb, {
      call_label: "misconceptions", source: "ai", operation: "class_misconceptions",
      provider: AI_PROVIDER, model: MODEL, latency_ms: performance.now() - started, success: false,
    }, { school_id: schoolId, request_id: requestId });
    return json({ error: `Claude request failed: ${(e as Error).message}` }, 502);
  }
  const usage = data?.usage || {};

  // ── Parse + sanitise (clamp lengths; drop hallucinated question ids) ────────
  const raw = (data?.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return json({ error: "The model returned malformed output — try again." }, 502); }

  const validIds = new Set(inputs.map((q: any) => q.question_id));
  // Maps so each misconception can carry the REAL topic it belongs to (derived from
  // the questions it shows up in), which the "reteach" action needs to save questions.
  const topicIdByQ = new Map<string, string>(inputs.map((q: any) => [q.question_id, q.topic_id]));
  const topicNameById = new Map<string, string>(inputs.map((q: any) => [q.topic_id, q.topic_name]));

  const misconceptions = (Array.isArray(parsed?.misconceptions) ? parsed.misconceptions : [])
    .map((m: any) => {
      const question_ids = (Array.isArray(m?.question_ids) ? m.question_ids : [])
        .filter((id: string) => validIds.has(id)).slice(0, 20);
      // Dominant topic across this misconception's questions.
      const tally: Record<string, number> = {};
      for (const id of question_ids) {
        const tid = topicIdByQ.get(id);
        if (tid) tally[tid] = (tally[tid] || 0) + 1;
      }
      let topic_id: string | null = null, best = -1;
      for (const [tid, c] of Object.entries(tally)) if (c > best) { best = c; topic_id = tid; }
      return {
        title: String(m?.title || "").trim().slice(0, 120),
        topic_id,
        topic_name: (topic_id && topicNameById.get(topic_id)) || String(m?.topic_name || "").trim().slice(0, 120),
        pupils: Math.max(0, Math.min(999, Number(m?.pupils) || 0)),
        explanation: String(m?.explanation || "").trim().slice(0, 600),
        example_wrong: String(m?.example_wrong || "").trim().slice(0, 300),
        fix: String(m?.fix || "").trim().slice(0, 400),
        question_ids,
      };
    })
    .filter((m: any) => m.title && m.explanation)
    .slice(0, 5);

  // ── Cache the run (service-role write; teachers read via RLS) ───────────────
  const computed_at = new Date().toISOString();
  sb.from("class_misconception_runs").insert({
    class_id, topic_id, days,
    result: { misconceptions },
    model: MODEL,
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    computed_by: user.id,
    computed_at,
    request_hash: hash,
  }).then(() => {}).catch((e) => console.error("run cache insert failed:", e));

  return json({ misconceptions, computed_at, model: MODEL, cached: false });
});
