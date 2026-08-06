// Public health endpoint for uptime monitoring (UptimeRobot / Better Stack /
// GitHub Actions cron). It actively marks one known answer and checks the
// verdict source, so it catches the failure that went unnoticed for ~3 days:
// AI marking silently falling back to local fuzzy matching (Anthropic
// key/billing). Returns 200 when marking is healthy, 503 otherwise — point a
// monitor at GET /api/health and alert on 503.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public Supabase ref + anon key (already shipped in the browser bundle; RLS protects data).
const SUPA = "https://uvzukwoxqhcxaxtzrziy.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2enVrd294cWhjeGF4dHpyeml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyNTIsImV4cCI6MjA4OTkyMTI1Mn0.PtT24EfMfTckYaq9jXBPRuCsG6utWMLcHs9H8buM70c";

const HEALTHY = new Set(["ai", "ai_double_check_confirmed", "ai_double_check_overturned", "numerical_match", "exact_match", "cache"]);

export async function GET() {
  const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  try {
    const r = await fetch(`${SUPA}/functions/v1/mark-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({
        question: "Why do plants need chlorophyll?",
        model_answer: "to absorb light energy for photosynthesis",
        student_answer: "it absorbs light energy so the plant can photosynthesise",
        marks: 1,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !HEALTHY.has(d.source)) {
      // "error"/"fallback" => Anthropic call failed (key/billing) — the silent outage.
      return json({ ok: false, reason: "AI marking unhealthy", source: d.source ?? null, status: r.status }, 503);
    }
    return json({ ok: true, source: d.source }, 200);
  } catch (e) {
    return json({ ok: false, reason: "mark-answer unreachable", error: String(e) }, 503);
  }
}
