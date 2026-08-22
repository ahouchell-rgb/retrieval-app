"use client";
import { useState, useEffect } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Card, Kicker, Headline, Deck, Btn, Badge } from "./ui";
import { MarkingQuality } from "./MarkingQuality";

/* MarkReview — the marking-trust surface. AI marks every answer, but the teacher
 * stays in control: this queue shows the marks the model itself was UNSURE about
 * (ai_confidence low/medium, set by mark-answer) and not yet reviewed, with the
 * question, the model answer, the pupil's answer and the AI verdict. One click
 * confirms it, or overrides correct/incorrect. The override + "reviewed" flag use
 * the responses_update policy (teacher-of-class), so pupils can't touch their own.
 * Deterministic marks (high confidence) never enter the queue. */
export function MarkReview({ cls, user }) {
  const [rows, setRows] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null); // response id being saved

  const load = async () => {
    if (!cls?.id) { setRows([]); return; }
    setRows(null); setErr("");
    try {
      const resp = await sb.q("responses", { params: {
        class_id: `eq.${cls.id}`, ai_confidence: "in.(low,medium)", teacher_reviewed: "eq.false",
        order: "answered_at.desc", limit: "40",
        select: "id,student_id,question_id,student_answer,is_correct,marks_awarded,original_is_correct,original_marks_awarded,ai_feedback,ai_confidence,answered_at",
      } });
      const list = Array.isArray(resp) ? resp : [];
      if (!list.length) { setRows([]); return; }
      // Join question + pupil name client-side (avoids embed FK-name fragility).
      const qIds = [...new Set(list.map(r => r.question_id).filter(Boolean))];
      const sIds = [...new Set(list.map(r => r.student_id).filter(Boolean))];
      const [qs, ps] = await Promise.all([
        qIds.length ? sb.q("questions", { params: { id: `in.(${qIds.join(",")})`, select: "id,question_text,model_answer,marks" } }) : [],
        sIds.length ? sb.q("profiles", { params: { id: `in.(${sIds.join(",")})`, select: "id,display_name" } }) : [],
      ]);
      const qMap = {}; (qs || []).forEach(q => { qMap[q.id] = q; });
      const pMap = {}; (ps || []).forEach(p => { pMap[p.id] = p.display_name; });
      setRows(list.map(r => ({ ...r, q: qMap[r.question_id] || null, pupil: pMap[r.student_id] || "Pupil" })));
    } catch (e) { setErr(e.message || "Could not load the review queue"); setRows([]); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cls?.id]);

  // Patch the response and drop it from the queue. `body` always sets teacher_reviewed.
  const resolve = async (row, body) => {
    setBusy(row.id);
    try {
      const nextCorrect = body.is_correct ?? row.is_correct;
      const original = row.original_is_correct ?? row.is_correct;
      await sb.q("responses", { method: "PATCH", params: { id: `eq.${row.id}` }, body: {
        ...body,
        teacher_reviewed: true,
        review_decision: nextCorrect === original ? "accepted" : nextCorrect ? "override_correct" : "override_incorrect",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      } });
      setRows(prev => (prev || []).filter(r => r.id !== row.id));
    } catch (e) { setErr(e.message || "Could not save — check you teach this class"); }
    setBusy(null);
  };
  const keep = (row) => resolve(row, {});
  const setCorrect = (row, correct) => resolve(row, { is_correct: correct, marks_awarded: correct ? (row.q?.marks || 1) : 0 });

  if (rows === null) return (
    <><Card style={{ padding: 16, marginTop: 4 }}><div style={{ fontSize: 12, color: C.dim }}>Loading marks to review…</div></Card><MarkingQuality cls={cls} user={user} /></>
  );

  if (!rows.length) return (
    <><Card style={{ padding: "16px 18px", marginTop: 4, borderLeft: `3px solid ${C.grn}` }}>
      <Kicker color={C.grn}>Review marks</Kicker>
      <Headline size={18} style={{ marginBottom: 2 }}>Nothing to review</Headline>
      <div style={{ fontSize: 13, color: C.mid }}>{err || "Every AI mark for this class was high-confidence, or you've reviewed them all. The queue surfaces only the marks the AI was unsure about."}</div>
    </Card><MarkingQuality cls={cls} user={user} /></>
  );

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

  return (
    <><Card style={{ padding: "18px 18px 14px", marginTop: 4, borderLeft: `3px solid ${C.amb}` }}>
      <Kicker color={C.amb}>Review marks · you're in control</Kicker>
      <Headline size={18} style={{ marginBottom: 2 }}>{rows.length} to check</Headline>
      <Deck style={{ marginBottom: 14 }}>The AI flagged these as borderline. Confirm its mark or override it — pupils only ever see the final mark.</Deck>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => (
          <div key={r.id} style={{ border: `1px solid ${C.bdr}`, borderRadius: 10, padding: 12, background: C.card2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.dim }}>{r.pupil} · {fmtDate(r.answered_at)}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Badge color={r.ai_confidence === "low" ? C.red : C.amb}>{r.ai_confidence} confidence</Badge>
                <Badge color={r.is_correct ? C.grn : C.red}>AI: {r.is_correct ? "correct" : "incorrect"}</Badge>
              </span>
            </div>
            <div style={{ fontSize: 13, color: C.txt, fontWeight: 600, marginBottom: 4 }}>{r.q?.question_text || "(question unavailable)"}</div>
            {r.q?.model_answer && <div style={{ fontSize: 12, color: C.grn, marginBottom: 6 }}>Model: {r.q.model_answer}</div>}
            <div style={{ fontSize: 13, color: C.txt, padding: "8px 10px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: ".1em" }}>Pupil wrote</span><br />{r.student_answer}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn onClick={() => keep(r)} disabled={busy === r.id} style={{ fontSize: 12, padding: "6px 12px" }}>{busy === r.id ? "…" : "✓ Looks right"}</Btn>
              <Btn v="ghost" onClick={() => setCorrect(r, true)} disabled={busy === r.id} style={{ fontSize: 12, padding: "6px 12px", color: C.grn, borderColor: "rgba(22,165,88,.4)" }}>Mark correct</Btn>
              <Btn v="ghost" onClick={() => setCorrect(r, false)} disabled={busy === r.id} style={{ fontSize: 12, padding: "6px 12px", color: C.red, borderColor: "rgba(239,68,68,.3)" }}>Mark incorrect</Btn>
            </div>
          </div>
        ))}
      </div>
    </Card><MarkingQuality cls={cls} user={user} /></>
  );
}
