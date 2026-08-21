"use client";
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";

// ─── Live AI-marking cost dashboard ───
// Reads real spend straight from the ai_usage token log via the moderator-only
// get_ai_cost_summary RPC (one aggregated round-trip — scales to millions of rows).
// Every marking writes one row tagged with its source, so the free-vs-AI blend, the
// per-mark cost and the annual run-rate are all MEASURED, not estimated.

// Anthropic list pricing (USD per 1M tokens). Model identity now comes from each
// usage row, so occasional Sonnet staff operations are not priced as Haiku.
const HAIKU_PRICE = { input: 1.0, output: 5.0, cacheRead: 0.10, cacheWrite: 1.25 };
const SONNET_PRICE = { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 };
const priceFor = (model = "") => String(model).includes("sonnet") ? SONNET_PRICE : HAIKU_PRICE;
const USD_TO_GBP = 0.79;

// Fixed infrastructure (annual GBP) shown for context alongside the variable AI cost.
const FIXED = [
  { label: "Supabase Pro", gbp: 25 * 12 * USD_TO_GBP },
  { label: "Vercel Pro", gbp: 20 * 12 * USD_TO_GBP },
];

const SOURCE_META = {
  ai: { label: "AI marked", color: C.pri, free: false },
  ai_double_check: { label: "AI double-check", color: C.pri, free: false },
  cache: { label: "Cache hit", color: C.grn || "#16a34a", free: true },
  exact_match: { label: "Exact match", color: C.grn || "#16a34a", free: true },
  numerical_match: { label: "Number match", color: C.grn || "#16a34a", free: true },
  client_flagged: { label: "Flagged junk", color: C.amb, free: true },
  shortcut: { label: "Other shortcut", color: C.mid, free: true },
};

export function CostDashboard({ students = [], classes = [], teachers = [], responses30d = [] }) {
  const [summary, setSummary] = useState(null); // null = loading, false = error, object = data
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const load = async (d) => {
    setLoading(true);
    try {
      const data = await sb.rpc("get_ai_cost_summary", { p_days: d });
      setSummary(data && typeof data === "object" ? data : {});
    } catch (e) {
      console.error("cost summary failed", e);
      setSummary(false);
    }
    setLoading(false);
  };

  useEffect(() => { load(days); /* eslint-disable-next-line */ }, []);

  // pence-aware GBP formatter
  const fmt = (usd) => {
    const p = usd * USD_TO_GBP * 100;
    if (p < 1) return `${p.toFixed(2)}p`;
    if (p < 100) return `${p.toFixed(0)}p`;
    return `£${(p / 100).toFixed(2)}`;
  };
  const fmtYr = (usd) => {
    const g = usd * USD_TO_GBP;
    return g < 1 ? `${(g * 100).toFixed(0)}p` : `£${g.toFixed(g < 100 ? 2 : 0)}`;
  };

  const windowSelector = (
    <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: C.dim, marginRight: 4 }}>Window:</span>
      {[1, 7, 30].map((d) => (
        <button key={d} onClick={() => { setDays(d); load(d); }}
          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${days === d ? C.pri : C.bdr}`, background: days === d ? C.priSoft : "transparent", color: days === d ? C.pri : C.mid, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
          {d === 1 ? "24h" : `${d}d`}
        </button>
      ))}
      <button onClick={() => load(days)} disabled={loading}
        style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}>
        {loading ? "Loading…" : "Refresh"}
      </button>
    </div>
  );

  if (summary === false) {
    return (
      <div>
        {windowSelector}
        <div style={{ padding: 30, textAlign: "center", color: C.red, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
          Couldn't load the cost summary (moderator only).
          <button onClick={() => load(days)} style={{ marginLeft: 8, color: C.pri, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Retry</button>
        </div>
      </div>
    );
  }

  const s = summary && typeof summary === "object" ? summary : {};
  const byModel = Array.isArray(s.by_model) ? s.by_model : [];
  const usd = byModel.length
    ? byModel.reduce((sum, row) => {
        const p = priceFor(row.model);
        return sum + ((row.input_tokens || 0) * p.input + (row.output_tokens || 0) * p.output + (row.cache_read_tokens || 0) * p.cacheRead + (row.cache_write_tokens || 0) * p.cacheWrite) / 1_000_000;
      }, 0)
    : ((s.input_tokens || 0) * HAIKU_PRICE.input + (s.output_tokens || 0) * HAIKU_PRICE.output + (s.cache_read_tokens || 0) * HAIKU_PRICE.cacheRead + (s.cache_write_tokens || 0) * HAIKU_PRICE.cacheWrite) / 1_000_000;
  const markings = s.markings || 0;
  const aiMarks = s.ai_markings || 0;
  const secondCalls = s.second_calls || 0;
  const shortcutMarks = s.shortcut_markings || 0;
  const aiSharePct = markings > 0 ? Math.round((aiMarks / markings) * 100) : 0;
  const freeSharePct = markings > 0 ? 100 - aiSharePct : 0;
  const costPerMarkUsd = markings > 0 ? usd / markings : 0;
  const annualUsd = usd * (365 / Math.max(days, 1));
  const annualGbp = annualUsd * USD_TO_GBP;
  const pupilCount = students.length;
  const annualPerPupilGbp = pupilCount > 0 ? annualGbp / pupilCount : 0;
  const fixedGbp = FIXED.reduce((a, f) => a + f.gbp, 0);

  const bySource = s.by_source || {};
  const sourceRows = Object.entries(bySource)
    .map(([k, v]) => ({ key: k, count: v, ...(SOURCE_META[k] || { label: k, color: C.mid, free: true }) }))
    .sort((a, b) => b.count - a.count);

  // Department attribution: this month's recorded responses × the live blended cost/mark.
  const classTeacher = Object.fromEntries(classes.map((c) => [c.id, c.teacher_id]));
  const teacherHod = Object.fromEntries(teachers.map((t) => [t.id, t.hod_id || null]));
  const hodName = Object.fromEntries(teachers.filter((t) => t.role === "hod").map((h) => [h.id, h.display_name || h.email || "—"]));
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthResps = responses30d.filter((r) => new Date(r.answered_at).getTime() >= startOfMonth);
  const deptAgg = {};
  monthResps.forEach((r) => {
    const tid = classTeacher[r.class_id];
    if (!tid) return;
    const hid = teacherHod[tid] || "__unassigned__";
    if (!deptAgg[hid]) deptAgg[hid] = { hid, responses: 0, teacherIds: new Set() };
    deptAgg[hid].responses++;
    deptAgg[hid].teacherIds.add(tid);
  });
  const deptRows = Object.values(deptAgg)
    .map((d) => ({
      hid: d.hid,
      name: d.hid === "__unassigned__" ? "Unassigned" : `${hodName[d.hid] || "—"}'s department`,
      teacherCount: d.teacherIds.size,
      responses: d.responses,
      usd: d.responses * costPerMarkUsd,
      pct: monthResps.length > 0 ? (d.responses / monthResps.length) * 100 : 0,
    }))
    .sort((a, b) => b.usd - a.usd);

  const since = s.min_ts ? new Date(s.min_ts) : null;
  const tile = (bg, border) => ({ padding: "16px 18px", background: bg, border, borderRadius: 12 });
  const card = { padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 };
  const cap = { fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 };

  return (
    <div>
      {windowSelector}

      {markings === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
          No marking activity logged in this window yet. Once students answer questions, live spend and the free-vs-AI blend appear here.
        </div>
      ) : (
        <>
          {/* Headline */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div style={tile(`linear-gradient(135deg, ${C.priSoft}, transparent)`, `1px solid ${C.pri}33`)}>
              <div style={{ ...cap, marginBottom: 4 }}>Spend · last {days === 1 ? "24h" : `${days}d`}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.pri, lineHeight: 1 }}>{fmt(usd)}</div>
              <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>{markings.toLocaleString()} marks · {fmt(costPerMarkUsd)}/mark</div>
            </div>
            <div style={tile(C.card, `1px solid ${C.bdr}`)}>
              <div style={{ ...cap, marginBottom: 4 }}>AI cost · at this rate / yr</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.txt, lineHeight: 1 }}>{fmtYr(annualUsd)}</div>
              <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>{pupilCount > 0 ? `£${annualPerPupilGbp.toFixed(2)}/pupil/yr · ${pupilCount} pupils` : "add pupils for per-pupil"}</div>
            </div>
          </div>

          {/* Marking blend */}
          <div style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Marking blend</span>
              <span style={{ fontSize: 11, color: C.mid }}><strong style={{ color: C.grn || "#16a34a" }}>{freeSharePct}%</strong> free · <strong style={{ color: C.pri }}>{aiSharePct}%</strong> AI</span>
            </div>
            <div style={{ display: "flex", height: 8, borderRadius: 99, overflow: "hidden", marginBottom: 10, background: C.bdr }}>
              {sourceRows.map((r) => (
                <div key={r.key} title={`${r.label}: ${r.count}`} style={{ width: `${(r.count / markings) * 100}%`, background: r.color }} />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sourceRows.map((r) => (
                <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: C.txt }}>
                    {r.label}
                    {r.free && <span style={{ color: C.grn || "#16a34a", fontSize: 10, marginLeft: 6 }}>free</span>}
                  </span>
                  <span style={{ fontFamily: "monospace", color: C.mid }}>{r.count.toLocaleString()}</span>
                  <span style={{ fontFamily: "monospace", color: C.dim, width: 38, textAlign: "right" }}>{Math.round((r.count / markings) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Detail row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div style={card}>
              <div style={cap}>AI calls</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{(aiMarks + secondCalls).toLocaleString()}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{aiMarks.toLocaleString()} first · {secondCalls.toLocaleString()} re-check</div>
            </div>
            <div style={card}>
              <div style={cap}>Skipped the AI</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: C.grn || "#16a34a" }}>{freeSharePct}%</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{shortcutMarks.toLocaleString()} free marks</div>
            </div>
            <div style={card}>
              <div style={cap}>Cost / 1,000 marks</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{fmt(costPerMarkUsd * 1000)}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>blended over all marks</div>
            </div>
          </div>

          {/* Total cost of ownership */}
          <div style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Projected annual run-rate</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 12 }}>
              <div style={{ color: C.txt }}>AI marking (variable)</div><div style={{ fontFamily: "monospace", textAlign: "right", color: C.txt }}>£{annualGbp.toFixed(0)}</div>
              {FIXED.map((f) => (
                <div key={f.label} style={{ display: "contents" }}>
                  <div style={{ color: C.mid }}>{f.label} (fixed)</div><div style={{ fontFamily: "monospace", textAlign: "right", color: C.mid }}>£{f.gbp.toFixed(0)}</div>
                </div>
              ))}
              <div style={{ color: C.txt, fontWeight: 700, borderTop: `1px solid ${C.bdr}`, paddingTop: 4, marginTop: 2 }}>Total / yr</div>
              <div style={{ fontFamily: "monospace", textAlign: "right", fontWeight: 700, color: C.pri, borderTop: `1px solid ${C.bdr}`, paddingTop: 4, marginTop: 2 }}>£{(annualGbp + fixedGbp).toFixed(0)}</div>
            </div>
          </div>

          {/* Department attribution */}
          {deptRows.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>By department · this month</div>
              {deptRows.map((d) => (
                <div key={d.hid} style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10, marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{d.name}</div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{d.teacherCount} teacher{d.teacherCount === 1 ? "" : "s"} · {d.responses.toLocaleString()} mark{d.responses === 1 ? "" : "s"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{fmt(d.usd)}</div>
                      <div style={{ fontSize: 10, color: C.dim }}>{d.pct.toFixed(0)}% of marks</div>
                    </div>
                  </div>
                  <div style={{ height: 4, background: C.bdr, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${d.pct}%`, height: "100%", background: d.hid === "__unassigned__" ? C.amb : C.pri, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </>
          )}

          <div style={{ marginTop: 16, padding: "10px 12px", background: C.card, border: `1px dashed ${C.bdr}`, borderRadius: 8, fontSize: 11, color: C.mid, lineHeight: 1.6 }}>
            <strong style={{ color: C.txt }}>How this is calculated.</strong> Real spend from the <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3 }}>ai_usage</code> token log, priced by the provider and model recorded on each call (Haiku for marking; Sonnet where a staff workflow uses it). Every marking writes one source-tagged row, so the blend and per-mark cost are <em>measured, not estimated</em>. "At this rate" annualises the window linearly{since ? `; data goes back to ${since.toLocaleDateString("en-GB")}` : ""}. Department figures attribute this month's recorded marks at the blended per-mark rate.
          </div>
        </>
      )}
    </div>
  );
}
