import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* emit-funnel-event — anonymous funnel telemetry for the public booklet embed.
 * The widget POSTs booklet_viewed / widget_opened / question_answered /
 * signup_clicked events here; we record them (service role) into
 * anon_funnel_events for the moderator funnel dashboard. Best-effort by design:
 * it ALWAYS returns 200 and never blocks the learner, validates the event name,
 * and caps string lengths so it can't be used to dump junk. No grade, no PII. */

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

const ALLOWED = new Set(["booklet_viewed", "widget_opened", "question_answered", "signup_clicked"]);
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const uuidOrNull = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!sb) return ok();
    const b = await req.json().catch(() => ({}));
    if (!ALLOWED.has(b?.event)) return ok();

    await sb.from("anon_funnel_events").insert({
      session_id: clip(b.session_id, 64),
      event: b.event,
      ref: clip(b.ref, 80),
      from_source: clip(b.from_source, 120),
      topic_id: uuidOrNull(b.topic_id),
      topic_name: clip(b.topic_name, 160),
      correct: typeof b.correct === "boolean" ? b.correct : null,
      marks_awarded: Number.isFinite(b.marks_awarded) ? Math.max(0, Math.min(20, b.marks_awarded | 0)) : null,
    });
  } catch { /* fail open — telemetry never blocks the learner */ }
  return ok();
});