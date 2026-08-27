// SERVER-ONLY Supabase + OpenAI helpers for the API routes.
//
// ⚠️ NEVER import this from a client component — it reads the service-role key and
// the OpenAI key from process.env. Only the Node API routes (server) use it.
//
// Extracted so the paper-feedforward and parse-paper-docx routes share one copy of
// the auth / metering / cost-backstop logic instead of duplicating it (the kind of
// edge-function copy-paste the ecosystem review flagged).

import { createHash } from "node:crypto";

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPA_URL || "https://uvzukwoxqhcxaxtzrziy.supabase.co";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPA_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MARKING_MODEL = process.env.OPENAI_MARKING_MODEL || "gpt-5-mini-2025-08-07";
export const OPENAI_STAFF_MODEL = process.env.OPENAI_STAFF_MODEL || "gpt-5.4-mini";

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// Service-role PostgREST helper (raw fetch — the app deliberately has no supabase-js dep).
export async function rest(path, { method = "GET", body, params = {}, single } = {}) {
  const u = new URL(`${SUPA_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const headers = { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  if (single) headers["Accept"] = "application/vnd.pgrst.object+json";
  if (method === "POST" || method === "PATCH") headers["Prefer"] = "return=representation";
  const r = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
  if (method === "DELETE") return null;
  return r.json();
}

export async function rpc(fn, args) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Identify the caller from their Supabase JWT (also validates the token).
export async function getAuthedUid(req) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${m[1]}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
  } catch { return null; }
}

// Structured AI usage logging shared by the Node routes. Callers may await it
// when the record must be durable before the response is returned.
export function logUsage(label, school_id, usage, {
  provider = "openai", model = null, request_id = null, response_id = null,
  operation = label, latency_ms = 0, success = true, source = "ai",
} = {}) {
  usage = usage || {};
  return rest("ai_usage", { method: "POST", body: {
    call_label: label,
    source,
    school_id,
    provider,
    model,
    request_id,
    response_id,
    operation,
    latency_ms: Math.max(0, Math.round(Number(latency_ms) || 0)),
    success: !!success,
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    cache_creation_tokens: Number(usage.cache_creation_input_tokens ?? usage.input_tokens_details?.cache_write_tokens) || 0,
    cache_read_tokens: Number(usage.cache_read_input_tokens ?? usage.input_tokens_details?.cached_tokens) || 0,
  } }).catch((e) => console.error("ai_usage insert failed:", e));
}

// Hard cost backstop (same RPC as mark-paper-answer). Fails OPEN on any error so a
// transient issue never blocks staff.
export async function overBackstop(school_id) {
  if (!school_id) return false;
  try {
    const data = await rpc("school_mark_status", { p_school_id: school_id });
    const r = Array.isArray(data) ? data[0] : data;
    return !!(r && r.over_backstop);
  } catch { return false; }
}

// One OpenAI Responses call. Responses are not stored by the provider. Structured
// output is used where a route supplies a schema so malformed JSON is far rarer.
export async function openAIResponses({
  model,
  max_output_tokens,
  instructions,
  input,
  schema,
  schema_name = "result",
  reasoning_effort = "minimal",
  prompt_cache_key,
}) {
  const body = {
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
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ...data, _telemetry: { latency_ms: performance.now() - started, success: r.ok && data?.status === "completed", status: r.status } };
}

// Pull the first text output out of an OpenAI Responses payload.
export function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text.trim();
    }
  }
  return "";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function contentHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function getCachedOperation(operation, request_hash, maxAgeSeconds = null) {
  const params = {
    operation: `eq.${operation}`,
    request_hash: `eq.${request_hash}`,
    select: "result,model,created_at",
    limit: "1",
  };
  if (maxAgeSeconds) params.created_at = `gte.${new Date(Date.now() - maxAgeSeconds * 1000).toISOString()}`;
  try {
    const rows = await rest("ai_operation_cache", { params });
    return rows?.[0] || null;
  } catch { return null; }
}

export async function putCachedOperation({ operation, request_hash, actor_id, school_id, provider = "openai", model, result }) {
  try {
    await rest("ai_operation_cache", { method: "POST", body: {
      operation, request_hash, actor_id, school_id, provider, model, result,
    } });
  } catch { /* a concurrent identical request may have inserted first */ }
}
