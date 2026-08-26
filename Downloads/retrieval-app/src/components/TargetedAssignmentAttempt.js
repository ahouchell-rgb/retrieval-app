"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { useCloudDraft } from "../hooks/useCloudState";
import { MathInput } from "./MathInput";
import { Badge, Btn, Card, Dateline, Deck, DraftSyncStatus, Headline, Kicker, Skeleton, TA } from "./ui";

export function TargetedAssignmentAttempt({ assignment, user, cls, onExit }) {
  const [questions, setQuestions] = useState([]);
  const [answered, setAnswered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [links, existing] = await Promise.all([
        sb.q("retrieval_assignment_questions", { params: { assignment_id: `eq.${assignment.id}`, select: "question_id,sort_order", order: "sort_order.asc" } }),
        sb.q("responses", { params: { assignment_id: `eq.${assignment.id}`, student_id: `eq.${user.id}`, select: "id,question_id,is_correct,marks_awarded,answered_at", order: "answered_at.asc" } }),
      ]);
      const ids = (links || []).map(link => link.question_id);
      const bank = ids.length ? await sb.q("questions", { params: { id: `in.(${ids.join(",")})`, select: "*,topics(name)" } }) : [];
      const byId = new Map((bank || []).map(q => [q.id, q]));
      setQuestions((links || []).map(link => byId.get(link.question_id)).filter(Boolean));
      setAnswered(existing || []);
    } catch (e) { setError(e.message || "Could not open this assignment."); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [assignment.id]);

  const answeredIds = useMemo(() => new Set(answered.map(r => r.question_id)), [answered]);
  const current = questions.find(q => !answeredIds.has(q.id));
  const correct = answered.filter(r => r.is_correct).length;
  const complete = questions.length > 0 && answeredIds.size >= questions.length;
  const shown = current || (result ? questions.find(q => q.id === answered.at(-1)?.question_id) : null);
  const pct = answered.length ? Math.round((correct / answered.length) * 100) : 0;
  const isMaths = cls?.subjects?.marker_profile === "maths";
  const draftKey = current?.id ? `student.assignmentDraft.${user.id}.${assignment.id}.${current.id}` : null;
  const { status: draftStatus, lastSavedAt: draftSavedAt, clearDraft } = useCloudDraft({
    userId: user.id, draftKey, value: answer, onRestore: setAnswer, disabled: !draftKey || !!result,
  });
  const updateAnswer = value => setAnswer(value);

  const remember = (question, verdict) => {
    setAnswered(rows => [...rows, {
      id: verdict.response_id || `pending-${question.id}`,
      question_id: question.id,
      is_correct: !!verdict.correct,
      marks_awarded: verdict.marks_awarded || 0,
      answered_at: new Date().toISOString(),
    }]);
    clearDraft();
    setResult(verdict); setMarking(false); lock.current = false;
  };

  const submitText = async () => {
    if (!current || !answer.trim() || marking || lock.current) return;
    lock.current = true; setMarking(true); setError("");
    try {
      const verdict = await sb.submitAnswer({
        question: current.question_text, model_answer: current.model_answer,
        student_answer: answer, marks: current.marks, question_id: current.id,
        class_id: cls.id, student_id: user.id, assignment_id: assignment.id,
        skipFakeCheck: isMaths,
      });
      remember(current, verdict);
    } catch (e) { setError(e.message || "Could not mark that answer."); setMarking(false); lock.current = false; }
  };

  const submitMcq = async (index) => {
    if (!current || marking || result || lock.current) return;
    lock.current = true; setMarking(true); setError("");
    try {
      const options = current.options || [];
      const chosen = options[index] || "";
      const verdict = await sb.recordMcqResponse({
        question_id: current.id, class_id: cls.id, student_id: user.id,
        student_answer: chosen, selected_index: index, correct: index === current.correct_index,
        marks: current.marks, feedback: "", assignment_id: assignment.id,
      });
      setAnswer(chosen); remember(current, verdict);
    } catch (e) { setError(e.message || "Could not save that answer."); setMarking(false); lock.current = false; }
  };

  const next = () => { setAnswer(""); setResult(null); setError(""); lock.current = false; };

  if (loading) return <main className="student-shell" aria-label="Opening assignment" style={{ padding: 22, maxWidth: 620, margin: "0 auto" }}><Card style={{ padding: 20 }}><Skeleton width="35%" /><Skeleton width="80%" height={30} style={{ marginTop: 14 }} /><Skeleton height={110} style={{ marginTop: 18 }} /></Card></main>;

  return (
    <main className="student-shell" style={{ padding: "16px 16px 60px", maxWidth: 660, margin: "0 auto" }}>
      <Dateline left="Targeted practice" right={cls.name} style={{ marginBottom: 14 }} />
      <button onClick={onExit} style={{ background: "none", border: "none", padding: 0, marginBottom: 14, color: C.mid, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← Back to class</button>

      <Card style={{ padding: 18, marginBottom: 14, background: C.panel, borderColor: C.panel }}>
        <Kicker color="#93a1b2">Your teacher assigned this</Kicker>
        <Headline size={25} style={{ color: "#fff", marginBottom: 5 }}>{assignment.title}</Headline>
        {assignment.instructions && <Deck style={{ color: "#cbd5e1", marginBottom: 10 }}>{assignment.instructions}</Deck>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#cbd5e1", fontSize: 11 }}>
          <Badge color={C.pri} style={{ background: "rgba(255,255,255,.12)", color: "#fff" }}>{Math.min(answeredIds.size, questions.length)}/{questions.length}</Badge>
          {assignment.due_at && <span>Due {new Date(assignment.due_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        <div style={{ height: 7, marginTop: 12, background: "rgba(255,255,255,.15)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${questions.length ? Math.min(100, answeredIds.size / questions.length * 100) : 0}%`, height: "100%", background: "#78d5bb" }} /></div>
      </Card>

      {error && <div style={{ color: C.red, background: C.redS, padding: "9px 11px", borderRadius: 7, marginBottom: 10, fontSize: 12 }}>{error}</div>}

      {complete && !result ? (
        <Card style={{ padding: 26, textAlign: "center", borderLeft: `3px solid ${pct >= 70 ? C.grn : C.amb}` }}>
          <Kicker color={pct >= 70 ? C.grn : C.amb}>Assignment complete</Kicker>
          <Headline size={32} style={{ margin: "8px 0" }}>{correct}/{questions.length} correct</Headline>
          <Deck style={{ marginBottom: 16 }}>{pct >= 70 ? "You have strengthened this topic. Your teacher can see the improvement." : "Your teacher can see which parts still need another look."}</Deck>
          <Btn onClick={onExit}>Return to class</Btn>
        </Card>
      ) : shown ? (
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12 }}><Badge color={C.pri}>{shown.topics?.name || "Retrieval"}</Badge><span style={{ fontSize: 11, color: C.dim }}>{shown.marks} mark{shown.marks === 1 ? "" : "s"}</span></div>
          <Headline size={20} style={{ marginBottom: 16 }}>{shown.question_text}</Headline>

          {shown.kind === "mcq" && Array.isArray(shown.options) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shown.options.map((option, index) => <button key={index} onClick={() => submitMcq(index)} disabled={marking || !!result} style={{ padding: "11px 13px", textAlign: "left", borderRadius: 8, border: `1px solid ${answer === option ? C.pri : C.bdr}`, background: answer === option ? C.priSoft : C.card2, color: C.txt, cursor: result ? "default" : "pointer", fontFamily: "inherit" }}>{option}</button>)}
            </div>
          ) : isMaths ? (
            <MathInput value={answer} onChange={updateAnswer} disabled={marking || !!result} onSubmit={submitText} />
          ) : (
            <TA value={answer} onChange={e => updateAnswer(e.target.value)} disabled={marking || !!result} rows={4} maxLength={2000} placeholder="Write your answer in your own words…" style={{ fontSize: 16, lineHeight: 1.65 }} />
          )}

          {!result && shown.kind !== "mcq" ? <div style={{ minHeight: 22, display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 6 }}><DraftSyncStatus status={draftStatus} lastSavedAt={draftSavedAt}/></div> : null}
          {!result && shown.kind !== "mcq" && <Btn onClick={submitText} disabled={!answer.trim() || marking} style={{ width: "100%", marginTop: 10 }}>{marking ? "Marking…" : "Check answer"}</Btn>}

          {result && (
            <div style={{ marginTop: 14, padding: 13, borderRadius: 8, background: result.correct ? C.grnS : C.redS, borderLeft: `3px solid ${result.correct ? C.grn : C.red}` }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: result.correct ? C.grn : C.red }}>{result.correct ? "Correct" : "Not yet"}</div>
              {result.feedback && <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.5, marginTop: 5 }}>{result.feedback}</div>}
              <Btn onClick={next} style={{ width: "100%", marginTop: 10 }}>{answeredIds.size >= questions.length ? "See result" : "Next question"}</Btn>
            </div>
          )}
        </Card>
      ) : (
        <Card style={{ padding: 22, textAlign: "center" }}><div style={{ color: C.mid }}>No questions are available for this assignment.</div></Card>
      )}
    </main>
  );
}
