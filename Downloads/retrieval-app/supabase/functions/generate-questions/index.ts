import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  AI_PROVIDER, logUsage, OPENAI_API_KEY, OPENAI_MARKING_MODEL,
  openAIResponse, openAIResponseText, requestHash, type UsageEvent,
} from "../_shared/ai.ts";

// AI question generation for the question bank (Tier-2: question acquisition).
// Staff-only. Returns DRAFTS — it never writes to `questions`; the teacher reviews
// and saves them through the normal client insert (which RLS + the plan gate and the
// shared-guard trigger still govern). OpenAI usage is logged to ai_usage like the
// markers, tagged call_label='generate' so it shows in the cost dashboard.
const MODEL = OPENAI_MARKING_MODEL;
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

const SYSTEM_PROMPT = `You are a UK secondary science teacher writing retrieval-practice questions for an exam-style question bank (AQA-aligned). Write factually accurate, curriculum-appropriate questions with concise, mark-scheme-style model answers.

RULES:
- Each question is short-answer recall/application suitable for low-stakes retrieval practice, NOT multiple choice.
- The model answer is the mark scheme: concise, the key creditworthy point(s) only. For multi-mark questions list the distinct points. Use the bracket conventions teachers expect, e.g. "Combustion (burning)" or "9.8 N/kg (accept 10 N/kg)".
- marks is an integer 1-6 and must match the demand of the question (a single recall fact = 1; "give two reasons" = 2; an explanation = 2-3).
- Use correct SI units and standard notation. Keep questions self-contained (no "as shown in the diagram").
- Vary difficulty and sub-topics across the set; do not repeat the same fact.
- British spelling.

Return the requested questions using the supplied JSON schema.`;

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_text: { type: "string" },
          model_answer: { type: "string" },
          marks: { type: "integer", minimum: 1, maximum: 6 },
        },
        required: ["question_text", "model_answer", "marks"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!OPENAI_API_KEY) return json({ error: "AI generation is not configured." }, 500);
    if (!sb) return json({ error: "Server not configured." }, 500);

    // Auth: a valid JWT for a staff member (teacher / hod / moderator / admin).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth token" }, 401);
    const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Invalid token" }, 401);
    const { data: profile } = await sb.from("profiles").select("role, school_id").eq("id", user.id).single();
    const role = profile?.role;
    if (!profile || !["teacher", "hod", "moderator", "admin"].includes(role)) {
      return json({ error: "Only staff can generate questions" }, 403);
    }

    const { topic_name, count, key_stage, existing, focus } = await req.json();
    const topic = String(topic_name || "").trim();
    if (!topic) return json({ error: "Missing topic_name" }, 400);
    const n = Math.max(1, Math.min(10, Number(count) || 5));
    const stage = ["KS3", "KS4", "GCSE"].includes(String(key_stage)) ? String(key_stage) : "KS3/KS4";
    const avoid = Array.isArray(existing) && existing.length
      ? `\n\nDo NOT duplicate or closely paraphrase these existing questions:\n- ${existing.slice(0, 25).map((s: unknown) => String(s).slice(0, 200)).join("\n- ")}`
      : "";
    // Optional: target a specific misconception (used by the misconception miner's
    // reteach action). These become REMEDIAL questions aimed at the exact confusion,
    // not generic topic recall. Absent → behaves exactly as before.
    const focusText = String(focus || "").trim().slice(0, 300);
    const focusLine = focusText
      ? `\n\nThese are REMEDIAL questions. Every one must directly re-test and correct this specific misconception the class showed: "${focusText}". Probe the exact distinction or step pupils got wrong head-on — do not drift to easier or unrelated facts.`
      : "";

    const userMsg = `Write ${n} ${stage} science retrieval questions for the topic: "${topic}".${focusLine}${avoid}`;
    const hash = await requestHash({ operation: "generate_questions", version: 2, user_id: user.id, model: MODEL, userMsg });
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const cached = await sb.from("ai_operation_cache")
      .select("result").eq("operation", "generate_questions").eq("request_hash", hash)
      .gte("created_at", since).limit(1);
    if (!cached.error && cached.data?.[0]?.result?.questions) {
      return json({ questions: cached.data[0].result.questions, cached: true });
    }

    const requestId = crypto.randomUUID();
    const result = await openAIResponse({
      model: MODEL,
      max_output_tokens: 1800,
      instructions: SYSTEM_PROMPT,
      input: userMsg,
      schema: QUESTIONS_SCHEMA,
      schema_name: "generated_questions",
      reasoning_effort: "minimal",
      prompt_cache_key: "question-generator-v3",
    });
    const data = result.data;
    const event: UsageEvent = {
      call_label: "generate", source: "generate_questions", operation: "generate_questions",
      provider: AI_PROVIDER, model: MODEL, usage: data?.usage,
      latency_ms: result.latency_ms, success: result.ok,
    };
    await logUsage(sb, event, { school_id: profile.school_id ?? null, request_id: requestId });
    if (!result.ok) return json({ error: `Question generation failed (${result.status})` }, 502);

    const clean = openAIResponseText(data);
    let items: unknown;
    try { items = JSON.parse(clean)?.questions; } catch { return json({ error: "The model returned malformed output — try again." }, 502); }
    const out = (Array.isArray(items) ? items : [])
      .map((q: Record<string, unknown>) => ({
        question_text: String(q?.question_text || "").trim().slice(0, 1000),
        model_answer: String(q?.model_answer || "").trim().slice(0, 2000),
        marks: Math.max(1, Math.min(6, Number(q?.marks) || 1)),
      }))
      .filter((q) => q.question_text && q.model_answer)
      .slice(0, n);

    if (!out.length) return json({ error: "No usable questions were generated — try a more specific topic." }, 502);
    await sb.from("ai_operation_cache").insert({
      operation: "generate_questions", request_hash: hash, actor_id: user.id,
      school_id: profile.school_id ?? null, provider: AI_PROVIDER, model: MODEL,
      result: { questions: out },
    }).then(() => {}).catch(() => {});
    return json({ questions: out, cached: false });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
