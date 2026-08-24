"use client";
import { useState, useEffect, useRef } from "react";
import { SUPA_KEY, SUPA_URL, sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { MathInput } from "./MathInput";
import { PaperManager } from "./PaperManager";
import { Btn, Card, TA } from "./ui";
import { useFeedback } from "./Feedback";

export function StudentPaperAttempt({ user, cls, paperId, onExit, forceNewAttempt = false }) {
  const { confirm, notify } = useFeedback();
  const [paper, setPaper] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attempt, setAttempt] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [responses, setResponses] = useState({}); // paper_question_id -> response row
  const [qi, setQi] = useState(0);
  const [ans, setAns] = useState("");
  const [marking, setMarking] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFinish, setShowFinish] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const submissionLockRef = useRef(false);

  useEffect(() => { (async () => {
    setLoading(true);
    try {
      setLoadError("");
      const [p, qs, assignmentRows] = await Promise.all([
        sb.q("papers", { params: { id: `eq.${paperId}`, select: "*,subjects(marker_profile)" } }),
        sb.q("paper_questions", { params: { paper_id: `eq.${paperId}`, select: "*", order: "sort_order.asc" } }),
        sb.q("paper_class_assignments", { params: { paper_id: `eq.${paperId}`, class_id: `eq.${cls.id}`, select: "instructions,due_at,attempt_limit" } }),
      ]);
      if (!p[0] || !qs?.length) { setLoading(false); return; }
      setPaper(p[0]); setQuestions(qs);
      setAssignment(assignmentRows?.[0] || null);

      // Find or create an attempt.
      // If forceNewAttempt is set (retake), always create fresh.
      // Otherwise: resume the most recent attempt only if it's still in progress (no submitted_at).
      // If the latest attempt is already submitted, create a new one — students who tap a submitted
      // paper from the home card are explicitly retaking.
      const existing = await sb.q("paper_attempts", { params: {
        paper_id: `eq.${paperId}`, student_id: `eq.${user.id}`, class_id: `eq.${cls.id}`,
        mode: "eq.full",
        select: "*", order: "started_at.desc"
      }});
      let att;
      const canResume = !forceNewAttempt && existing?.length && !existing[0].submitted_at;
      if (canResume) {
        att = existing[0];
      } else {
        const submittedCount = (existing || []).filter(row => row.submitted_at).length;
        const attemptLimit = assignmentRows?.[0]?.attempt_limit || 1;
        if (submittedCount >= attemptLimit) throw new Error("You have used all the attempts your teacher allowed for this paper.");
        const [created] = await sb.q("paper_attempts", { method: "POST", body: {
          paper_id: paperId, student_id: user.id, class_id: cls.id, mode: "full",
          total_marks: p[0].total_marks,
        }});
        att = created;
      }
      setAttempt(att);

      // Load any existing responses on this attempt
      const rs = await sb.q("paper_responses", { params: { attempt_id: `eq.${att.id}`, select: "*" } });
      const rmap = {};
      (rs || []).forEach(r => { rmap[r.paper_question_id] = r; });
      setResponses(rmap);
      // Resume at first unanswered question
      const firstUnanswered = qs.findIndex(q => !rmap[q.id]);
      setQi(firstUnanswered === -1 ? qs.length - 1 : firstUnanswered);
    } catch (e) { console.error("paper attempt load failed", e); setLoadError(e.message || "This paper could not be opened."); }
    setLoading(false);
  })(); }, [paperId, cls.id, user.id, forceNewAttempt]);

  const currentQ = questions[qi];
  const existingResp = currentQ ? responses[currentQ.id] : null;
  // Maths papers get the working-friendly input (symbol pad + live preview).
  // Keyed off the paper's subject marker_profile — the field the server resolves
  // to choose the maths marking overlay, so input and marking stay in step.
  const isMaths = paper?.subjects?.marker_profile === "maths";

  const submitAnswer = async () => {
    if (!ans.trim() || marking || !currentQ || submissionLockRef.current) return;
    submissionLockRef.current = true;
    setMarking(true);
    try {
      // The function grades from the DB's marking points AND writes the response
      // server-side (authoritative), so a pupil can't set their own exam marks.
      // Sending the pupil's token lets it identify them and record.
      const token = sb.auth.getToken();
      const r = await fetch(`${SUPA_URL}/functions/v1/mark-paper-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPA_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          attempt_id: attempt.id,
          paper_question_id: currentQ.id,
          question: currentQ.question_text,
          command_word: currentQ.command_word,
          marks: currentQ.marks,
          marking_points: currentQ.marking_points || [],
          student_answer: ans,
          request_id: crypto.randomUUID(),
        }),
      });
      const d = await r.json();
      if (d.recorded) {
        const row = { id: d.response_id, attempt_id: attempt.id, paper_question_id: currentQ.id, student_answer: ans, marks_awarded: d.marks_awarded ?? 0, marks_max: currentQ.marks, ai_feedback: d.feedback || null, awarded_points: d.awarded_points || [], flagged: !!d.flagged };
        setResponses(prev => ({ ...prev, [currentQ.id]: row }));
      } else {
        // Transition/fallback: store the SERVER's verdict directly. After the
        // lock-in migration this RLS path closes and every client records via
        // the function. Marks come from the function, never client-chosen.
        const body = { attempt_id: attempt.id, paper_question_id: currentQ.id, student_answer: ans, marks_awarded: d.marks_awarded ?? 0, marks_max: currentQ.marks, ai_feedback: d.feedback || null, awarded_points: d.awarded_points || [], flagged: !!d.flagged };
        if (existingResp) {
          await sb.q("paper_responses", { method: "PATCH", params: { id: `eq.${existingResp.id}` }, body });
          setResponses(prev => ({ ...prev, [currentQ.id]: { ...existingResp, ...body } }));
        } else {
          const [created] = await sb.q("paper_responses", { method: "POST", body });
          setResponses(prev => ({ ...prev, [currentQ.id]: created }));
        }
      }
      setLastResult(d);
    } catch (e) { console.error("mark failed", e); notify("We could not mark that answer. " + e.message, { title: "Marking failed" }); }
    submissionLockRef.current = false;
    setMarking(false);
  };

  const next = () => {
    setLastResult(null);
    setAns("");
    submissionLockRef.current = false;
    if (qi >= questions.length - 1) {
      // Last question — show finish screen
      setShowFinish(true);
    } else {
      setQi(qi + 1);
    }
  };

  const submitPaper = async () => {
    setSubmitting(true);
    try {
      const total = questions.reduce((s, q) => s + (q.marks || 0), 0);
      const awarded = Object.values(responses).reduce((s, r) => s + (r.marks_awarded || 0), 0);
      // awarded_marks / total_marks are maintained server-side by the marking
      // function (recomputed from the stored responses); the client only marks
      // the attempt submitted — so the score can't be forged.
      await sb.q("paper_attempts", { method: "PATCH", params: { id: `eq.${attempt.id}` }, body: {
        submitted_at: new Date().toISOString(),
      }});
      // Optimistic UI only — the authoritative totals already live on the row.
      setAttempt(prev => ({ ...prev, submitted_at: new Date().toISOString(), total_marks: total, awarded_marks: awarded }));
    } catch (e) { console.error("submit failed", e); notify("We could not submit the paper. " + e.message, { title: "Submission failed" }); }
    setSubmitting(false);
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.dim, fontSize: 13 }}>Loading paper…</div>;
  if (loadError) return <div style={{ padding: 40, textAlign: "center" }}><div style={{ fontSize: 13, color: C.txt, marginBottom: 12 }}>{loadError}</div><Btn onClick={onExit}>Back</Btn></div>;
  if (!paper || questions.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: C.txt, marginBottom: 12 }}>This paper has no questions yet.</div>
        <Btn onClick={onExit}>Back</Btn>
      </div>
    );
  }

  // ── Finish / submitted view ──
  if (showFinish || attempt?.submitted_at) {
    const submitted = !!attempt?.submitted_at;
    const totalAwarded = Object.values(responses).reduce((s, r) => s + (r.marks_awarded || 0), 0);
    const totalMax = questions.reduce((s, q) => s + (q.marks || 0), 0);
    const pct = totalMax > 0 ? Math.round((totalAwarded / totalMax) * 100) : 0;
    const tone = pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red;
    const answeredCount = Object.keys(responses).length;
    return (
      <div style={{ padding: "16px 16px 32px", maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <button onClick={onExit} style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>← Done</button>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{paper.name}</div>
        </div>

        <Card style={{ padding: 20, marginBottom: 12, textAlign: "center", background: `linear-gradient(135deg, ${tone}15, transparent)`, borderColor: `${tone}40` }}>
          <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{submitted ? "Submitted" : "Ready to submit"}</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: tone, lineHeight: 1 }}>{totalAwarded}/{totalMax}</div>
          <div style={{ fontSize: 14, color: C.txt, marginTop: 6, fontWeight: 600 }}>{pct}%</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>{answeredCount} of {questions.length} questions answered</div>
        </Card>

        {!submitted && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <Btn onClick={submitPaper} disabled={submitting} style={{ flex: 1 }}>{submitting ? "Submitting…" : "Submit paper"}</Btn>
            <Btn v="ghost" onClick={() => setShowFinish(false)} style={{ fontSize: 12 }}>Review</Btn>
          </div>
        )}

        {/* Per-question summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {questions.map((q, i) => {
            const r = responses[q.id];
            const qPct = r ? Math.round(((r.marks_awarded || 0) / Math.max(1, q.marks)) * 100) : 0;
            const qTone = !r ? C.dim : qPct >= 70 ? C.grn : qPct >= 50 ? C.amb : C.red;
            return (
              <Card key={q.id} style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{q.question_label || `Q${i + 1}`}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>{q.question_text.slice(0, 100)}{q.question_text.length > 100 ? "…" : ""}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {r ? (
                      <span style={{ fontSize: 13, fontWeight: 700, color: qTone }}>{r.marks_awarded}/{q.marks}</span>
                    ) : (
                      <span style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>Skipped</span>
                    )}
                  </div>
                </div>
                {r?.ai_feedback && submitted && (
                  <div style={{ fontSize: 11, color: C.mid, marginTop: 8, padding: "8px 10px", background: C.card2, borderRadius: 6, borderLeft: `2px solid ${qTone}`, lineHeight: 1.5 }}>{r.ai_feedback}</div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Question view ──
  const answeredSoFar = Object.keys(responses).length;
  const sessionPct = Math.round((answeredSoFar / questions.length) * 100);

  return (
    <div style={{ padding: "16px 16px 32px", maxWidth: 560, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={async () => { const approved = await confirm({ title: "Save and exit?", message: "Your progress will be kept and you can resume this paper later.", confirmLabel: "Save and exit", tone: "neutral" }); if (approved) onExit(); }}
          style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>← Save & exit</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paper.name}</div>
        </div>
        <button onClick={() => setShowFinish(true)} disabled={answeredSoFar === 0}
          style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card, color: C.mid, cursor: answeredSoFar === 0 ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: answeredSoFar === 0 ? 0.5 : 1 }}>
          Finish →
        </button>
      </div>

      {/* Progress */}
      {assignment?.instructions && <Card style={{ padding: "10px 12px", marginBottom: 12, fontSize: 11, color: C.mid, lineHeight: 1.5 }}>{assignment.instructions}</Card>}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: C.mid, marginBottom: 6 }}>
          <span>Question <span style={{ color: C.pri }}>{String(qi + 1).padStart(2, "0")}</span> of {String(questions.length).padStart(2, "0")}</span>
          <span>{answeredSoFar} answered</span>
        </div>
        <div style={{ height: 3, background: C.bdrSoft, borderRadius: 1.5, overflow: "hidden" }}>
          <div style={{ width: `${sessionPct}%`, height: "100%", background: C.pri, borderRadius: 1.5, transition: "width 0.3s ease" }} />
        </div>
      </div>

      {/* Question card */}
      <Card style={{ padding: 18, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.bdrSoft}` }}>
          <span style={{ fontSize: 10, color: C.pri, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }}>{currentQ.question_label || `Q${qi + 1}`}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {currentQ.command_word && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: C.priSoftBg, color: C.pri, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".12em" }}>{currentQ.command_word}</span>}
            <span style={{ fontFamily: C.serif, fontSize: 13, color: C.mid, fontStyle: "italic" }}><span style={{ color: C.txt, fontWeight: 600, fontStyle: "normal" }}>{currentQ.marks}</span> mark{currentQ.marks === 1 ? "" : "s"}</span>
          </div>
        </div>
        {currentQ.image_url && (
          <div style={{ marginBottom: 14, borderRadius: 3, overflow: "hidden", border: `1px solid ${C.bdr}`, background: "#fff" }}>
            <img src={currentQ.image_url} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "contain", display: "block" }} />
          </div>
        )}
        <div style={{ fontFamily: C.serif, fontSize: 19, color: C.txt, lineHeight: 1.4, marginBottom: 18, fontWeight: 500, letterSpacing: "-0.005em", whiteSpace: "pre-wrap" }}>{currentQ.question_text}</div>

        {!lastResult && (
          <>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: C.mid, marginBottom: 8 }}>Your answer</div>
            {isMaths ? (
              <MathInput value={ans} onChange={setAns} rows={Math.max(3, Math.min(8, currentQ.marks * 2))} placeholder="Write your working here — press Enter for a new line" disabled={marking} />
            ) : (
              <TA value={ans} onChange={e => setAns(e.target.value)} rows={Math.max(3, Math.min(8, currentQ.marks * 2))} placeholder="Write your answer here…" disabled={marking} style={{ fontFamily: C.serif, fontSize: 15, lineHeight: 1.5 }} />
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Btn onClick={submitAnswer} disabled={!ans.trim() || marking} style={{ flex: 1 }}>{marking ? "Marking…" : "Submit answer"}</Btn>
              {qi < questions.length - 1 && (
                <Btn v="ghost" onClick={() => { setAns(""); setQi(qi + 1); }} style={{ fontSize: 12 }}>Skip →</Btn>
              )}
            </div>
          </>
        )}

        {lastResult && (
          <div style={{ marginTop: 4, animation: "slideUp .25s ease" }}>
            <div style={{ padding: "12px 14px", background: lastResult.marks_awarded === currentQ.marks ? C.grnS : lastResult.marks_awarded > 0 ? C.ambS : C.redS, borderRadius: 8, borderLeft: `3px solid ${lastResult.marks_awarded === currentQ.marks ? C.grn : lastResult.marks_awarded > 0 ? C.amb : C.red}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>
                  {lastResult.marks_awarded === currentQ.marks ? "Full marks" : lastResult.marks_awarded > 0 ? "Partial credit" : "No marks awarded"}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>{lastResult.marks_awarded}/{currentQ.marks}</span>
              </div>
              <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.5 }}>{lastResult.feedback}</div>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <Btn onClick={next} style={{ flex: 1 }}>{qi >= questions.length - 1 ? "Finish →" : "Next question →"}</Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── PaperManager — past paper authoring, assignment, and results (V1) ─── */
