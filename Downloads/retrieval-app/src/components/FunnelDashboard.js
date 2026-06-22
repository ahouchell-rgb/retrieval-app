"use client";
import { useState, useEffect } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Card, Pill, Kicker, Headline, Deck } from "./ui";

/* FunnelDashboard — the public-booklet conversion funnel (move #5). Reads the
 * moderator-gated get_funnel_summary RPC over anon_funnel_events: per booklet,
 * how many sessions viewed the embed → opened the widget → answered a question →
 * clicked sign-up. Tells us which booklets actually convert, so we know where to
 * invest. Best-effort: anon events are fire-and-forget, so treat counts as a
 * lower bound. */
export function FunnelDashboard() {
  const [rows, setRows] = useState(null); // null = loading, false = error, [] = empty
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);

  const load = async (d) => {
    setLoading(true);
    try {
      const data = await sb.rpc("get_funnel_summary", { p_days: d });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("funnel summary failed", e);
      setRows(false);
    }
    setLoading(false);
  };
  useEffect(() => { load(days); /* eslint-disable-next-line */ }, []);

  const num = (n) => Number(n || 0);
  const pctOf = (a, b) => (num(b) > 0 ? Math.round((num(a) / num(b)) * 100) : 0);

  const agg = (rows && rows.length ? rows : []).reduce((a, r) => ({
    sessions: a.sessions + num(r.sessions), viewed: a.viewed + num(r.viewed),
    opened: a.opened + num(r.opened), answered: a.answered + num(r.answered),
    signup: a.signup + num(r.signup_clicked),
  }), { sessions: 0, viewed: 0, opened: 0, answered: 0, signup: 0 });

  return (
    <Card style={{ padding: "18px 18px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Kicker>Booklet funnel</Kicker>
          <Headline size={18} style={{ marginBottom: 2 }}>Public booklets → practice → sign-up</Headline>
          <Deck style={{ marginBottom: 12 }}>Per booklet: how many readers open the widget, answer, and click sign-up. Anonymous + best-effort.</Deck>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[7, 14, 30].map(d => <Pill key={d} on={days === d} onClick={() => { setDays(d); load(d); }} style={{ fontSize: 11, padding: "5px 10px" }}>{d}d</Pill>)}
        </div>
      </div>

      {rows === null ? <div style={{ fontSize: 12, color: C.dim, padding: "12px 0" }}>Loading funnel…</div>
        : rows === false ? <div style={{ fontSize: 13, color: C.red }}>Couldn&rsquo;t load the funnel (moderators only). <button onClick={() => load(days)} style={{ color: C.pri, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Retry</button></div>
        : rows.length === 0 ? <div style={{ fontSize: 13, color: C.mid }}>No booklet-embed activity in this window yet.</div>
        : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              {[
                { l: "Sessions", v: agg.sessions, c: C.txt },
                { l: "Opened widget", v: agg.opened, c: C.acc },
                { l: "Answered", v: agg.answered, c: C.pri },
                { l: "Clicked sign-up", v: agg.signup, c: C.grn },
                { l: "Answer → sign-up", v: pctOf(agg.signup, agg.answered) + "%", c: C.grn },
              ].map(s => (
                <Card key={s.l} style={{ padding: "12px 14px", flex: "1 1 0", minWidth: 110, textAlign: "center" }}>
                  <div style={{ fontFamily: C.serif, fontSize: 24, fontWeight: 600, color: s.c, lineHeight: 1 }}>{typeof s.v === "number" ? s.v.toLocaleString() : s.v}</div>
                  <div style={{ fontSize: 9, color: C.mid, marginTop: 6, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 600 }}>{s.l}</div>
                </Card>
              ))}
            </div>

            <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 8 }}>By booklet</div>
            {rows.map((r, i) => (
              <div key={i} style={{ padding: "10px 0", borderTop: i ? `1px solid ${C.bdrSoft}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ref || "—"}</span>
                  <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{num(r.sessions)} sessions · {pctOf(r.answered, r.viewed)}% answer · {pctOf(r.signup_clicked, r.answered)}% → sign-up</span>
                </div>
                <div style={{ position: "relative", height: 6, borderRadius: 3, overflow: "hidden", background: C.bdrSoft }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pctOf(r.opened, r.sessions)}%`, background: C.accSoft }} title={`opened ${num(r.opened)}`} />
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pctOf(r.answered, r.sessions)}%`, background: C.pri }} title={`answered ${num(r.answered)}`} />
                </div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>opened {num(r.opened)} · answered {num(r.answered)} ({num(r.answered_correct)} got it right) · sign-up {num(r.signup_clicked)}</div>
              </div>
            ))}
          </>
        )}
    </Card>
  );
}
