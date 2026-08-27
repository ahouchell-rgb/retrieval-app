// Public checks are deliberately free: they verify that the deployed marking
// function is reachable without triggering a provider call. A secret-gated deep
// check verifies OpenAI at most once per 15 minutes.
import { OPENAI_API_KEY, OPENAI_MARKING_MODEL, openAIResponses, logUsage } from "../../../lib/serverSupa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPA = process.env.NEXT_PUBLIC_SUPA_URL || "https://uvzukwoxqhcxaxtzrziy.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPA_KEY;
const MODEL = OPENAI_MARKING_MODEL;
const DEEP_TTL_MS = 15 * 60 * 1000;
let deepCache = null;

const response = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function reachabilityCheck() {
  try {
    const headers = { origin: "https://retrieval-app.com" };
    if (ANON) headers.apikey = ANON;
    const r = await fetch(`${SUPA}/functions/v1/mark-answer`, {
      method: "OPTIONS",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    // Any non-5xx response proves the edge service is reachable. OPTIONS is
    // deliberately used so this never reaches the paid marking path.
    return r.status < 500
      ? { ok: true, check: "reachability" }
      : { ok: false, reason: "Marking service unavailable.", status: r.status };
  } catch {
    return { ok: false, reason: "Marking service unreachable." };
  }
}

async function deepCheck() {
  if (deepCache && Date.now() - deepCache.at < DEEP_TTL_MS) return { ...deepCache.result, cached: true };
  if (!OPENAI_API_KEY) return { ok: false, reason: "AI provider is not configured.", check: "deep" };
  const requestId = crypto.randomUUID();
  const data = await openAIResponses({
    model: MODEL,
    max_output_tokens: 16,
    input: "Reply OK",
    reasoning_effort: "minimal",
  });
  const ok = !!data?._telemetry?.success;
  await logUsage("health", null, data?.usage, {
    model: MODEL,
    request_id: requestId,
    operation: "health_check",
    latency_ms: data?._telemetry?.latency_ms,
    success: ok,
  }).catch(() => {});
  const result = ok ? { ok: true, check: "deep" } : { ok: false, reason: "AI provider unavailable.", check: "deep" };
  deepCache = { at: Date.now(), result };
  return result;
}

export async function GET(req) {
  const configuredSecret = process.env.HEALTH_CHECK_SECRET || "";
  const suppliedSecret = req.headers.get("x-health-check-secret") || "";
  const wantsDeep = suppliedSecret.length > 0;

  if (wantsDeep) {
    if (!configuredSecret || suppliedSecret !== configuredSecret) return response({ ok: false, reason: "Not authorised." }, 401);
    try {
      const result = await deepCheck();
      return response(result, result.ok ? 200 : 503);
    } catch {
      return response({ ok: false, reason: "AI provider unreachable.", check: "deep" }, 503);
    }
  }

  const result = await reachabilityCheck();
  return response(result, result.ok ? 200 : 503);
}
