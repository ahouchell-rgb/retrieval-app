"use client";
import { useState, useEffect } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Card, Badge, Bar, Kicker, Headline, Deck, Btn } from "./ui";

/* ClassGaps — the actionable headline of the dashboard: the objectives this
 * class is weakest on, read straight from the objective-mastery spine
 * (the class_weak_objectives view). Each gap carries the scheme-of-work unit it
 * maps to, so "what to reteach" links back to "what to plan". Topics whose
 * curriculum strand has no scheme unit yet show "no unit" rather than a guess.
 *
 * The view is security_invoker, so RLS on responses scopes it to this teacher's
 * own classes — we still pass class_id for the specific class on screen. */
export function ClassGaps({ cls }) {
  const [rows, setRows] = useState(null); // null = loading, [] = none/loaded-empty
  const [err, setErr] = useState(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let live = true;
    if (!cls?.id) { setRows([]); return; }
    setRows(null); setErr(null);
    Promise.all([
      sb.q("class_weak_objectives", { params: {
        class_id: `eq.${cls.id}`,
        weakness_rank: "lte.6",
        order: "weakness_rank.asc",
        select: "topic_id,topic_name,pct_correct,marked,students,last_seen,unit_code,unit_title",
      } }),
      sb.loadBooklets().catch(() => null), // so each gap can offer a "Revise this topic" booklet link
    ])
      .then(([d]) => { if (live) setRows(Array.isArray(d) ? d : []); })
      .catch(e => { if (live) { setErr(e.message || "Could not load gaps"); setRows([]); } });
    return () => { live = false; };
  }, [cls?.id]);

  // In-app reteach: build a printable intervention sheet (pupil worksheet + teacher
  // mark scheme) straight from this class's weakest topics and the real questions in
  // them. Closes the loop in-product — no external authoring app needed.
  const printIntervention = async () => {
    if (!rows || !rows.length) return;
    setBuilding(true);
    try {
      const weak = rows.filter(r => r.topic_id);
      const topicIds = [...new Set(weak.map(r => r.topic_id))];
      const byTopic = {};
      if (topicIds.length) {
        const qs = await sb.q("questions", { params: {
          topic_id: `in.(${topicIds.join(",")})`, archived: "eq.false",
          select: "topic_id,question_text,model_answer,marks", order: "difficulty.asc,created_at.asc",
        } });
        (Array.isArray(qs) ? qs : []).forEach(q => { (byTopic[q.topic_id] = byTopic[q.topic_id] || []).push(q); });
      }
      const esc = (s) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const section = (r, withAnswers) => {
        const qs = (byTopic[r.topic_id] || []).slice(0, 5);
        if (!qs.length) return "";
        const items = qs.map((q, i) => `
          <div class="q"><div class="qt"><span class="n">${i + 1}.</span> ${esc(q.question_text)} <span class="mk">[${q.marks}]</span></div>
          ${withAnswers ? `<div class="ans">${esc(q.model_answer)}</div>` : `<div class="line"></div><div class="line"></div>`}</div>`).join("");
        return `<section><h2>${esc(r.topic_name)} <span class="pc">${Math.round(r.pct_correct)}% in class</span></h2>${items}</section>`;
      };
      const pupil = weak.map(r => section(r, false)).filter(Boolean).join("");
      const teacher = weak.map(r => section(r, true)).filter(Boolean).join("");
      if (!pupil) { alert("No questions in these topics yet — add some in the question bank first."); setBuilding(false); return; }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cls.name)} — intervention</title>
        <style>
          body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1a14;margin:30px;max-width:720px}
          h1{font-family:Georgia,serif;font-size:24px;margin:0 0 2px}
          .sub{color:#6f6a5c;font-size:12px;margin-bottom:16px}
          section{margin:0 0 16px;break-inside:avoid}
          h2{font-family:Georgia,serif;font-size:16px;margin:14px 0 8px;border-bottom:1px solid #d4cdb8;padding-bottom:4px}
          .pc{font-family:-apple-system,sans-serif;font-size:11px;color:#e54a26;font-weight:600;float:right}
          .q{margin:0 0 10px;font-size:13px;line-height:1.5}
          .n{font-weight:600;color:#6f6a5c}
          .mk{color:#a8a294;font-size:11px}
          .ans{color:#16a558;font-size:12px;margin-top:3px;padding-left:18px}
          .line{border-bottom:1px solid #d4cdb8;height:16px;margin:6px 18px 0}
          .pagebreak{page-break-before:always}
          .keyhdr{font-family:Georgia,serif;font-size:20px;margin:0 0 10px}
          @media print{ @page{margin:14mm} }
        </style></head><body>
        <h1>${esc(cls.name)} — targeted reteach</h1>
        <div class="sub">Built from this class's weakest retrieval topics · ${date} · Feynman Education</div>
        ${pupil}
        <div class="pagebreak"></div><div class="keyhdr">Teacher mark scheme</div>${teacher}
        <script>window.onload=function(){window.print()}<\/script></body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } catch (e) { console.error("intervention build failed", e); }
    setBuilding(false);
  };

  if (rows === null) return (
    <Card style={{ padding: 16, marginTop: 18 }}>
      <div style={{ fontSize: 12, color: C.dim }}>Loading class gaps…</div>
    </Card>
  );

  // Not enough marked answers anywhere yet — say so plainly rather than show an empty box.
  if (!rows.length) return (
    <Card style={{ padding: "16px 18px", marginTop: 18, borderLeft: `3px solid ${C.grn}` }}>
      <Kicker color={C.grn}>Class gaps</Kicker>
      <div style={{ fontSize: 13, color: C.mid }}>
        {err || "No clear gaps yet — a topic needs at least 5 marked answers before it appears here."}
      </div>
    </Card>
  );

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

  return (
    <Card style={{ padding: "18px 18px 14px", marginTop: 18, borderLeft: `3px solid ${C.red}` }}>
      <Kicker color={C.red}>Class gaps · reteach these</Kicker>
      <Headline size={18} style={{ marginBottom: 2 }}>Weakest objectives</Headline>
      <Deck style={{ marginBottom: 12 }}>Lowest accuracy first, from retrieval answers — the unit tag shows where to plan.</Deck>
      <Btn onClick={printIntervention} disabled={building} style={{ fontSize: 12, padding: "7px 12px", marginBottom: 14 }}>
        {building ? "Building…" : "⎙ Print intervention sheet"}
      </Btn>
      {rows.map((r, i) => {
        const pct = Math.round(r.pct_correct);
        const col = pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red;
        const unit = r.unit_title || r.unit_code;
        const bk = sb.bookletFor(r.topic_id);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${C.bdrSoft}` : "none" }}>
            <div style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 600, color: col, minWidth: 46, textAlign: "right", letterSpacing: "-0.02em" }}>{pct}%</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.topic_name}</div>
              <div style={{ marginTop: 5 }}><Bar pct={pct} label={r.topic_name} /></div>
              <div style={{ marginTop: 5, fontSize: 10, color: C.dim, letterSpacing: ".02em" }}>{r.marked} marked · {r.students} pupil{r.students === 1 ? "" : "s"} · last {fmtDate(r.last_seen)}</div>
              {bk && <a href={bk.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 5, fontSize: 11, fontWeight: 600, color: C.pri, textDecoration: "none" }}>📖 Revise this topic ↗</a>}
            </div>
            {unit
              ? <Badge color={C.acc} style={{ flexShrink: 0 }}>{unit}</Badge>
              : <span style={{ flexShrink: 0, fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: ".12em" }}>no unit</span>}
          </div>
        );
      })}
    </Card>
  );
}
