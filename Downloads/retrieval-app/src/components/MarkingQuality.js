"use client";
import { useEffect, useMemo, useState } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Badge, Btn, Card, Deck, Headline, Kicker } from "./ui";

export function MarkingQuality({ cls, user }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [showSample, setShowSample] = useState(false);

  const load = async () => {
    if (!cls?.id) return;
    setRows(null); setError("");
    try {
      const since = new Date(); since.setDate(since.getDate() - 90);
      const marked = await sb.q("responses", { params: {
        class_id: `eq.${cls.id}`, answered_at: `gte.${since.toISOString()}`,
        select: "id,student_id,question_id,student_answer,is_correct,marks_awarded,original_is_correct,original_marks_awarded,teacher_reviewed,review_decision,reviewed_at,ai_confidence,marking_source,marker_model,rubric_version,answered_at",
        order: "answered_at.desc", limit: "1000",
      } });
      const qIds = [...new Set((marked || []).map(r => r.question_id).filter(Boolean))];
      const sIds = [...new Set((marked || []).map(r => r.student_id).filter(Boolean))];
      const [questions, pupils] = await Promise.all([
        qIds.length ? sb.q("questions", { params: { id: `in.(${qIds.join(",")})`, select: "id,question_text,model_answer,marks" } }) : [],
        sIds.length ? sb.q("profiles", { params: { id: `in.(${sIds.join(",")})`, select: "id,display_name" } }) : [],
      ]);
      const qMap = new Map((questions || []).map(q => [q.id, q]));
      const pMap = new Map((pupils || []).map(p => [p.id, p.display_name]));
      setRows((marked || []).map(row => ({ ...row, question: qMap.get(row.question_id), pupil: pMap.get(row.student_id) || "Pupil" })));
    } catch (e) { setRows([]); setError(e.message || "Could not load marking quality."); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cls?.id]);

  const review = async (row, correct) => {
    setBusy(row.id); setError("");
    const unchanged = correct === row.original_is_correct;
    try {
      await sb.q("responses", { method: "PATCH", params: { id: `eq.${row.id}` }, body: {
        is_correct: correct,
        marks_awarded: correct ? (row.question?.marks || 1) : 0,
        teacher_reviewed: true,
        review_decision: unchanged ? "accepted" : correct ? "override_correct" : "override_incorrect",
        reviewed_at: new Date().toISOString(), reviewed_by: user.id,
      } });
      await load();
    } catch (e) { setError(e.message || "Could not save the review."); }
    setBusy(null);
  };

  const analysis = useMemo(() => {
    const list = rows || [];
    const reviewed = list.filter(r => r.teacher_reviewed && r.original_is_correct != null);
    const overrides = reviewed.filter(r => r.original_is_correct !== r.is_correct);
    const agreement = reviewed.length ? Math.round(((reviewed.length - overrides.length) / reviewed.length) * 100) : null;
    const uncertain = list.filter(r => r.ai_confidence === "low" || r.ai_confidence === "medium").length;
    const byQuestion = new Map();
    reviewed.forEach(r => {
      const item = byQuestion.get(r.question_id) || { id: r.question_id, text: r.question?.question_text || "Question unavailable", reviewed: 0, overrides: 0 };
      item.reviewed++;
      if (r.original_is_correct !== r.is_correct) item.overrides++;
      byQuestion.set(r.question_id, item);
    });
    const questions = [...byQuestion.values()].filter(q => q.reviewed >= 2).map(q => ({ ...q, rate: Math.round(q.overrides / q.reviewed * 100) })).sort((a, b) => b.rate - a.rate || b.reviewed - a.reviewed).slice(0, 6);
    const sources = {};
    list.forEach(r => { const source = r.marking_source || "unknown"; sources[source] = (sources[source] || 0) + 1; });
    const sample = list.filter(r => !r.teacher_reviewed && r.ai_confidence === "high" && String(r.marking_source || "").startsWith("ai")).slice(0, 5);
    return { reviewed, overrides, agreement, uncertain, questions, sources, sample };
  }, [rows]);

  if (rows === null) return <Card style={{ padding: 16, marginTop: 14 }}><div style={{ color: C.dim, fontSize: 12 }}>Loading marking assurance…</div></Card>;

  return (
    <Card style={{ padding: 18, marginTop: 14, borderLeft: `3px solid ${C.blue}` }}>
      <Kicker color={C.blue}>Marking assurance · last 90 days</Kicker>
      <Headline size={20} style={{ marginBottom: 3 }}>Know where the marker disagrees with you</Headline>
      <Deck style={{ marginBottom: 14 }}>Original automated decisions are retained, so overrides reveal weak questions or rubrics instead of silently rewriting the evidence.</Deck>
      {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 15 }}>
        {[
          { label: "Marked", value: rows.length, tone: C.txt },
          { label: "Reviewed", value: analysis.reviewed.length, tone: C.blue },
          { label: "Overridden", value: analysis.overrides.length, tone: analysis.overrides.length ? C.amb : C.grn },
          { label: "Agreement", value: analysis.agreement == null ? "—" : `${analysis.agreement}%`, tone: analysis.agreement == null ? C.dim : analysis.agreement >= 95 ? C.grn : C.amb },
        ].map(item => <div key={item.label} style={{ padding: 10, background: C.card2, border: `1px solid ${C.bdrSoft}`, borderRadius: 7 }}><div style={{ fontSize: 22, fontWeight: 800, color: item.tone }}>{item.value}</div><div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>{item.label}</div></div>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.txt, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Questions to calibrate</div>
          {analysis.questions.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>Review at least two answers for a question before its disagreement rate appears.</div> : analysis.questions.map(q => <div key={q.id} style={{ padding: "8px 0", borderTop: `1px solid ${C.bdrSoft}` }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 12, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.text}</span><Badge color={q.rate >= 20 ? C.red : q.rate ? C.amb : C.grn}>{q.rate}%</Badge></div><div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>{q.overrides}/{q.reviewed} teacher overrides</div></div>)}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.txt, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Marker mix</div>
          {Object.entries(analysis.sources).sort((a, b) => b[1] - a[1]).map(([source, count]) => <div key={source} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.bdrSoft}`, fontSize: 11 }}><span style={{ color: C.mid }}>{source.replaceAll("_", " ")}</span><span style={{ color: C.txt, fontWeight: 700 }}>{count}</span></div>)}
          <div style={{ fontSize: 10, color: C.dim, marginTop: 8 }}>{analysis.uncertain} low/medium-confidence mark{analysis.uncertain === 1 ? "" : "s"} in this period.</div>
        </div>
      </div>

      <div style={{ marginTop: 16, paddingTop: 13, borderTop: `1px solid ${C.bdr}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Quality sample</div><div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Spot-check high-confidence AI marks, not only the answers the model admits are uncertain.</div></div>
          <Btn v="ghost" onClick={() => setShowSample(v => !v)} style={{ fontSize: 11, padding: "6px 10px" }}>{showSample ? "Hide" : `Check ${analysis.sample.length}`}</Btn>
        </div>
        {showSample && <div style={{ marginTop: 10 }}>{analysis.sample.length === 0 ? <div style={{ color: C.dim, fontSize: 12 }}>No unchecked high-confidence AI marks are available.</div> : analysis.sample.map(row => <div key={row.id} style={{ padding: 11, marginTop: 7, background: C.card2, border: `1px solid ${C.bdrSoft}`, borderRadius: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}><span style={{ fontSize: 10, color: C.dim }}>{row.pupil}</span><Badge color={row.original_is_correct ? C.grn : C.red}>AI: {row.original_is_correct ? "correct" : "incorrect"}</Badge></div>
          <div style={{ color: C.txt, fontWeight: 600, fontSize: 12 }}>{row.question?.question_text || "Question unavailable"}</div>
          {row.question?.model_answer && <div style={{ color: C.grn, fontSize: 11, marginTop: 4 }}>Model: {row.question.model_answer}</div>}
          <div style={{ color: C.mid, fontSize: 12, marginTop: 6, padding: "7px 9px", background: C.card, borderRadius: 6 }}>Pupil: {row.student_answer}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}><Btn onClick={() => review(row, true)} disabled={busy === row.id} style={{ fontSize: 11, padding: "5px 9px" }}>Should be correct</Btn><Btn v="ghost" onClick={() => review(row, false)} disabled={busy === row.id} style={{ fontSize: 11, padding: "5px 9px" }}>Should be incorrect</Btn></div>
        </div>)}</div>}
      </div>
    </Card>
  );
}
