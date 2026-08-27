export const AI_PROVIDER = "openai";
const env = (name: string) => typeof Deno === "undefined" ? undefined : Deno.env.get(name);
export const OPENAI_API_KEY = env("OPENAI_API_KEY");
export const OPENAI_MARKING_MODEL = env("OPENAI_MARKING_MODEL") || "gpt-5-mini-2025-08-07";
export const OPENAI_STAFF_MODEL = env("OPENAI_STAFF_MODEL") || "gpt-5.4-mini";

type OpenAIResponseOptions = {
  model: string;
  max_output_tokens: number;
  instructions?: string;
  input: unknown;
  schema?: Record<string, unknown>;
  schema_name?: string;
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high";
  prompt_cache_key?: string;
};

export async function openAIResponse({
  model,
  max_output_tokens,
  instructions,
  input,
  schema,
  schema_name = "result",
  reasoning_effort = "minimal",
  prompt_cache_key,
}: OpenAIResponseOptions) {
  const body: Record<string, unknown> = {
    model,
    max_output_tokens,
    input,
    store: false,
    reasoning: { effort: reasoning_effort },
    text: schema
      ? { verbosity: "low", format: { type: "json_schema", name: schema_name, strict: true, schema } }
      : { verbosity: "low" },
  };
  if (instructions) body.instructions = instructions;
  if (prompt_cache_key) body.prompt_cache_key = prompt_cache_key;
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return {
    data,
    ok: response.ok && data?.status === "completed",
    status: response.status,
    latency_ms: performance.now() - started,
  };
}

export function openAIResponseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text.trim();
    }
  }
  return "";
}

export type RetrievalVerdict = {
  correct: boolean;
  marks_awarded: number;
  feedback: string;
  flagged: boolean;
  confidence?: "high" | "medium" | "low";
};

export type UsageEvent = {
  call_label: string;
  source: string;
  operation: string;
  provider: string;
  model: string;
  usage?: Record<string, unknown>;
  latency_ms: number;
  success: boolean;
};

export function validRequestId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
}

export function decodeRetrievalVerdict(value: Record<string, unknown>): RetrievalVerdict {
  const correct = Boolean(value.c ?? value.correct);
  const flagged = Boolean(value.x ?? value.flagged);
  const confidenceCode = String(value.q ?? value.confidence ?? "").toLowerCase();
  const confidence = confidenceCode === "h" || confidenceCode === "high" ? "high"
    : confidenceCode === "m" || confidenceCode === "medium" ? "medium"
    : confidenceCode === "l" || confidenceCode === "low" ? "low" : undefined;
  return {
    correct,
    marks_awarded: Number(value.m ?? value.marks_awarded),
    feedback: String(value.f ?? value.feedback ?? (correct ? "Correct." : "")),
    flagged,
    confidence,
  };
}

export function decodePaperVerdict(value: Record<string, unknown>) {
  return {
    marks_awarded: Number(value.m ?? value.marks_awarded),
    awarded_points: value.p ?? value.awarded_points,
    feedback: String(value.f ?? value.feedback ?? ""),
    flagged: Boolean(value.x ?? value.flagged),
  };
}

export async function logUsage(
  sb: any,
  event: UsageEvent,
  context: { school_id?: string | null; request_id?: string | null; response_id?: string | null },
) {
  if (!sb) return;
  const usage = event.usage || {};
  const { error } = await sb.from("ai_usage").insert({
    call_label: event.call_label,
    source: event.source,
    school_id: context.school_id ?? null,
    provider: event.provider,
    model: event.model,
    request_id: context.request_id ?? null,
    response_id: context.response_id ?? null,
    operation: event.operation,
    latency_ms: Math.max(0, Math.round(event.latency_ms || 0)),
    success: event.success,
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    cache_creation_tokens: Number(usage.cache_creation_input_tokens ?? (usage.input_tokens_details as any)?.cache_write_tokens) || 0,
    cache_read_tokens: Number(usage.cache_read_input_tokens ?? (usage.input_tokens_details as any)?.cached_tokens) || 0,
  });
  if (error) console.error("ai_usage insert failed:", error);
}

export async function logShortcut(
  sb: any,
  source: string,
  operation: string,
  context: { school_id?: string | null; request_id?: string | null; response_id?: string | null },
) {
  await logUsage(sb, {
    call_label: "shortcut",
    source,
    operation,
    provider: "local",
    model: "deterministic-v2",
    latency_ms: 0,
    success: true,
  }, context);
}

export async function claimRequest(sb: any, request_id: string, actor_id: string, operation: string) {
  const { data, error } = await sb.rpc("claim_marking_request", {
    p_request_id: request_id,
    p_actor_id: actor_id,
    p_operation: operation,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    claimed: row?.claimed === true,
    status: String(row?.request_status || "unknown"),
    response_id: row?.existing_response_id || null,
  };
}

export async function finishRequest(sb: any, request_id: string, status: "completed" | "failed", response_id?: string | null) {
  const { error } = await sb.from("marking_requests").update({
    status,
    response_id: response_id ?? null,
    updated_at: new Date().toISOString(),
  }).eq("request_id", request_id);
  if (error) console.error("marking request update failed:", error);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
