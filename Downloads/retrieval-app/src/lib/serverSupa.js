// SERVER-ONLY Supabase + Anthropic helpers for the API routes.
//
// ⚠️ NEVER import this from a client component — it reads the service-role key and
// the Anthropic key from process.env. Only the Node API routes (server) use it.
//
// Extracted so the paper-feedforward and parse-paper-docx routes share one copy of
// the auth / metering / cost-backstop logic instead of duplicating it (the kind of
// edge-function copy-paste the ecosystem review flagged).

import { createHash } from "node:crypto";

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPA_URL || "https://uvzukwoxqhcxaxtzrziy.supabase.co";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPA_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
  provider = "anthropic", model = null, request_id = null, response_id = null,
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
    cache_creation_tokens: Number(usage.cache_creation_input_tokens) || 0,
    cache_read_tokens: Number(usage.cache_read_input_tokens) || 0,
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

// One Anthropic Messages call. Returns the parsed response JSON ({ content, usage, ... }).
export async function anthropicMessages({ model, max_tokens, system, messages }) {
  const body = { model, max_tokens, messages };
  if (system) body.system = system;
  const started = performance.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ...data, _telemetry: { latency_ms: performance.now() - started, success: r.ok, status: r.status } };
}

// Pull the first text block out of an Anthropic response and strip code fences.
export function responseText(data) {
  const text = data?.content?.[0]?.text || "";
  return text.replace(/```json|```/g, "").trim();
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

export async function putCachedOperation({ operation, request_hash, actor_id, school_id, provider = "anthropic", model, result }) {
  try {
    await rest("ai_operation_cache", { method: "POST", body: {
      operation, request_hash, actor_id, school_id, provider, model, result,
    } });
  } catch { /* a concurrent identical request may have inserted first */ }
}
