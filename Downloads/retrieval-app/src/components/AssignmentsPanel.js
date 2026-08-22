"use client";
import { useEffect, useMemo, useState } from "react";
import { assignmentOutcome, fromLocalInputValue, workStatus } from "../lib/assignments";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { Badge, Btn, Card, Deck, Headline, Inp, Kicker, TA } from "./ui";

const EMPTY_DRAFT = {
  title: "", topicId: "", instructions: "", questionCount: 5,
  availableFrom: "", dueAt: "", status: "published", source: "manual",
};

const formatDate = (value) => value
  ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  : "No deadline";

export function AssignmentsPanel({ user, cls, topics, seed, onConsumed }) {
  const [assignments, setAssignments] = useState([]);
  const [pupils, setPupils] = useState([]);
  const [studentRows, setStudentRows] = useState([]);
  const [questionRows, setQuestionRows] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [selected, setSelected] = useState(new Set());
  const [baselines, setBaselines] = useState({});
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!cls?.id) return;
    setLoading(true); setMessage("");
    try {
      const [as, roster] = await Promise.all([
        sb.q("retrieval_assignments", { params: { class_id: `eq.${cls.id}`, status: "neq.archived", select: "*", order: "created_at.desc" } }),
        sb.q("class_members", { params: { class_id: `eq.${cls.id}`, select: "student_id,profiles(display_name,email)", order: "joined_at.asc" } }),
      ]);
      const ids = (as || []).map(a => a.id);
      const [students, questions, marked] = ids.length ? await Promise.all([
        sb.q("retrieval_assignment_students", { params: { assignment_id: `in.(${ids.join(",")})`, select: "*" } }),
        sb.q("retrieval_assignment_questions", { params: { assignment_id: `in.(${ids.join(",")})`, select: "*", order: "sort_order.asc" } }),
        sb.q("responses", { params: { assignment_id: `in.(${ids.join(",")})`, select: "assignment_id,student_id,question_id,is_correct,answered_at" } }),
      ]) : [[], [], []];
      setAssignments(as || []); setPupils(roster || []); setStudentRows(students || []);
      setQuestionRows(questions || []); setResponses(marked || []);
    } catch (e) { setMessage(e.message || "Could not load assignments."); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cls?.id]);

  const suggestPupils = async (topicId, preselected = null) => {
    setSelected(new Set(preselected || [])); setBaselines({});
    if (!topicId || !cls?.id) return;
    setSuggesting(true);
    try {
      const rows = await sb.rpc("class_intervention_list", { p_class_id: cls.id, p_threshold: 60, p_subject: null });
      const relevant = (Array.isArray(rows) ? rows : []).filter(r => r.topic_id === topicId);
      const map = {};
      relevant.forEach(r => { map[r.student_id] = { pct: Number(r.pct_correct), marked: Number(r.marked) || 0 }; });
      setBaselines(map);
      if (!preselected) setSelected(new Set(relevant.map(r => r.student_id)));
    } catch (e) { setMessage(e.message || "Could not suggest pupils."); }
    setSuggesting(false);
  };

  useEffect(() => {
    if (!seed?.nonce) return;
    const topic = topics.find(t => t.id === seed.topicId);
    const next = {
      ...EMPTY_DRAFT,
      topicId: seed.topicId || "",
      title: seed.title || (topic ? `${topic.name} — targeted practice` : "Targeted practice"),
      source: seed.source || "attention_queue",
    };
    setDraft(next); setCreating(true); setMessage("");
    suggestPupils(next.topicId, seed.studentIds?.length ? seed.studentIds : null);
    onConsumed?.();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [seed?.nonce]);

  const resetComposer = () => {
    setCreating(false); setDraft(EMPTY_DRAFT); setSelected(new Set()); setBaselines({}); setMessage("");
  };

  const setTopic = (topicId) => {
    const topic = topics.find(t => t.id === topicId);
    setDraft(d => ({ ...d, topicId, title: d.title || (topic ? `${topic.name} — targeted practice` : "") }));
    suggestPupils(topicId);
  };

  const createAssignment = async () => {
    if (!draft.topicId || selected.size === 0 || !draft.title.trim()) return;
    setBusy(true); setMessage("");
    let createdId = null;
    try {
      const bank = await sb.q("questions", { params: {
        topic_id: `eq.${draft.topicId}`, archived: "eq.false", select: "id,difficulty",
        order: "difficulty.asc,created_at.asc", limit: "100",
      } });
      const chosen = (bank || []).slice(0, Number(draft.questionCount));
      if (!chosen.length) throw new Error("This topic has no active questions yet.");
      const [created] = await sb.q("retrieval_assignments", { method: "POST", body: {
        class_id: cls.id, teacher_id: user.id, topic_id: draft.topicId,
        title: draft.title.trim(), instructions: draft.instructions.trim(),
        question_count: chosen.length, available_from: fromLocalInputValue(draft.availableFrom),
        due_at: fromLocalInputValue(draft.dueAt), status: draft.status, source: draft.source,
      } });
      createdId = created.id;
      await Promise.all([
        sb.q("retrieval_assignment_questions", { method: "POST", body: chosen.map((q, i) => ({ assignment_id: created.id, question_id: q.id, sort_order: i })) }),
        sb.q("retrieval_assignment_students", { method: "POST", body: [...selected].map(studentId => ({
          assignment_id: created.id, student_id: studentId,
          baseline_pct: baselines[studentId]?.pct ?? null,
          baseline_marked: baselines[studentId]?.marked ?? 0,
        })) }),
      ]);
      resetComposer();
      await load();
      setMessage(`Assignment created for ${selected.size} pupil${selected.size === 1 ? "" : "s"}.`);
    } catch (e) {
      if (createdId) await sb.del("retrieval_assignments", { id: `eq.${createdId}` }).catch(() => {});
      setMessage(e.message || "Could not create the assignment.");
    }
    setBusy(false);
  };

  const setStatus = async (id, status) => {
    setBusy(true); setMessage("");
    try { await sb.q("retrieval_assignments", { method: "PATCH", params: { id: `eq.${id}` }, body: { status, updated_at: new Date().toISOString() } }); await load(); }
    catch (e) { setMessage(e.message || "Could not update the assignment."); }
    setBusy(false);
  };

  const copyNudge = async (assignment, names) => {
    const due = assignment.due_at ? ` by ${formatDate(assignment.due_at)}` : "";
    const text = `Please complete “${assignment.title}”${due}. Open Feynman Education and choose ${cls.name}.`;
    try { await navigator.clipboard.writeText(text); setMessage(`Nudge copied for ${names.length} pupil${names.length === 1 ? "" : "s"}.`); }
    catch { setMessage(text); }
  };

  const summaries = useMemo(() => assignments.map(assignment => {
    const assigned = studentRows.filter(row => row.assignment_id === assignment.id);
    const assignmentQuestionIds = new Set(questionRows.filter(row => row.assignment_id === assignment.id).map(row => row.question_id));
    const perPupil = assigned.map(row => {
      const marked = responses.filter(r => r.assignment_id === assignment.id && r.student_id === row.student_id && assignmentQuestionIds.has(r.question_id));
      const distinct = new Map(); marked.forEach(r => distinct.set(r.question_id, r));
      const answers = [...distinct.values()];
      const correct = answers.filter(r => r.is_correct).length;
      const completedAt = row.completed_at || (answers.length >= assignmentQuestionIds.size && answers.length ? answers.map(r => r.answered_at).sort().at(-1) : null);
      const pupil = pupils.find(p => p.student_id === row.student_id);
      return {
        ...row, name: pupil?.profiles?.display_name || "Pupil", answered: answers.length,
        total: assignmentQuestionIds.size, completedAt, correct,
        outcome: assignmentOutcome({ baselinePct: row.baseline_pct, correct, total: answers.length, completedAt }),
        work: workStatus({ completedAt, dueAt: assignment.due_at, started: answers.length > 0 }),
      };
    });
    return { assignment, perPupil, completed: perPupil.filter(p => p.completedAt).length };
  }), [assignments, studentRows, questionRows, responses, pupils]);

  if (loading) return <Card style={{ padding: 18 }}><div style={{ color: C.dim, fontSize: 12 }}>Loading assignments…</div></Card>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div><Kicker>Assignments · close the loop</Kicker><Headline size={24}>Targeted practice</Headline><Deck>Turn a class gap into work for the pupils who need it, then see whether their answers improved.</Deck></div>
        <Btn onClick={() => { setCreating(true); setMessage(""); }} style={{ whiteSpace: "nowrap" }}>+ New assignment</Btn>
      </div>

      {message && <div style={{ padding: "9px 12px", marginBottom: 12, borderRadius: 6, background: C.priSoft, color: C.mid, fontSize: 12 }}>{message}</div>}

      {creating && (
        <Card style={{ padding: 16, marginBottom: 16, borderLeft: `3px solid ${C.pri}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>Create targeted practice</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, marginBottom: 8 }}>
            <select value={draft.topicId} onChange={e => setTopic(e.target.value)} style={selectStyle}>
              <option value="">Choose a topic…</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={draft.questionCount} onChange={e => setDraft(d => ({ ...d, questionCount: Number(e.target.value) }))} style={selectStyle}>
              {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} questions</option>)}
            </select>
          </div>
          <Inp value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Assignment title" style={{ marginBottom: 8 }} />
          <TA value={draft.instructions} onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))} rows={2} maxLength={2000} placeholder="Instructions for pupils (optional)" style={{ marginBottom: 8 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px", gap: 8, marginBottom: 12 }}>
            <label style={labelStyle}>Release<input type="datetime-local" value={draft.availableFrom} onChange={e => setDraft(d => ({ ...d, availableFrom: e.target.value }))} style={inputStyle} /></label>
            <label style={labelStyle}>Due<input type="datetime-local" value={draft.dueAt} onChange={e => setDraft(d => ({ ...d, dueAt: e.target.value }))} style={inputStyle} /></label>
            <label style={labelStyle}>State<select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))} style={inputStyle}><option value="published">Published</option><option value="draft">Draft</option></select></label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Pupils {suggesting ? "· finding the weakest…" : baselines && Object.keys(baselines).length ? `· ${Object.keys(baselines).length} suggested at 60% or below` : ""}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setSelected(new Set(Object.keys(baselines)))} style={linkButton}>Suggested</button>
              <button onClick={() => setSelected(new Set(pupils.map(p => p.student_id)))} style={linkButton}>Whole class</button>
              <button onClick={() => setSelected(new Set())} style={linkButton}>Clear</button>
            </div>
          </div>
          <div style={{ maxHeight: 210, overflow: "auto", border: `1px solid ${C.bdr}`, borderRadius: 7, marginBottom: 12 }}>
            {pupils.map((p, i) => {
              const on = selected.has(p.student_id), base = baselines[p.student_id];
              return <label key={p.student_id} style={{ display: "flex", gap: 9, alignItems: "center", padding: "9px 11px", borderTop: i ? `1px solid ${C.bdrSoft}` : "none", cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={() => setSelected(prev => { const next = new Set(prev); if (next.has(p.student_id)) next.delete(p.student_id); else next.add(p.student_id); return next; })} />
                <span style={{ flex: 1, color: C.txt, fontSize: 12 }}>{p.profiles?.display_name || "Pupil"}</span>
                {base && <Badge color={base.pct < 40 ? C.red : C.amb}>{base.pct}% · {base.marked} marked</Badge>}
              </label>;
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={createAssignment} disabled={busy || !draft.topicId || !draft.title.trim() || selected.size === 0}>{busy ? "Creating…" : `Assign to ${selected.size} pupil${selected.size === 1 ? "" : "s"}`}</Btn>
            <Btn v="ghost" onClick={resetComposer} disabled={busy}>Cancel</Btn>
          </div>
        </Card>
      )}

      {summaries.length === 0 ? (
        <Card style={{ padding: 26, textAlign: "center" }}><div style={{ color: C.mid, fontSize: 13 }}>No targeted assignments yet. Create one from here or from the attention queue.</div></Card>
      ) : summaries.map(({ assignment, perPupil, completed }) => {
        const topic = topics.find(t => t.id === assignment.topic_id);
        const unfinished = perPupil.filter(p => !p.completedAt);
        return (
          <Card key={assignment.id} style={{ padding: 15, marginBottom: 10, borderLeft: `3px solid ${assignment.status === "published" ? C.pri : C.dim}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{assignment.title}</span><Badge color={assignment.status === "published" ? C.grn : C.dim}>{assignment.status}</Badge></div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{topic?.name || "Mixed topics"} · {assignment.question_count} questions · due {formatDate(assignment.due_at)}</div>
              </div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 19, fontWeight: 800, color: completed === perPupil.length ? C.grn : C.txt }}>{completed}/{perPupil.length}</div><div style={{ fontSize: 10, color: C.dim }}>completed</div></div>
            </div>
            {unfinished.length > 0 && <button onClick={() => copyNudge(assignment, unfinished.map(p => p.name))} style={{ ...linkButton, marginTop: 9 }}>Copy nudge for {unfinished.length} unfinished</button>}
            <div style={{ marginTop: 10, borderTop: `1px solid ${C.bdrSoft}` }}>
              {perPupil.map((p, i) => {
                const tone = p.outcome.key === "recovered" ? C.grn : p.outcome.key === "improving" ? C.amb : p.outcome.key === "still_struggling" ? C.red : C.mid;
                return <div key={p.student_id} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) 85px 115px", gap: 8, alignItems: "center", padding: "9px 0", borderTop: i ? `1px solid ${C.bdrSoft}` : "none" }}>
                  <div><div style={{ fontSize: 12, color: C.txt, fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 10, color: C.dim }}>{p.answered}/{p.total} answered · {p.work.label}</div></div>
                  <div style={{ fontSize: 11, color: C.dim }}>Before {p.baseline_pct == null ? "—" : `${Math.round(p.baseline_pct)}%`}</div>
                  <Badge color={tone}>{p.outcome.pct == null ? p.outcome.label : `${p.outcome.label} · ${p.outcome.pct}%`}</Badge>
                </div>;
              })}
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
              {assignment.status === "published" ? <Btn v="ghost" onClick={() => setStatus(assignment.id, "closed")} disabled={busy} style={{ fontSize: 11, padding: "5px 9px" }}>Close</Btn> : assignment.status === "closed" ? <Btn v="ghost" onClick={() => setStatus(assignment.id, "published")} disabled={busy} style={{ fontSize: 11, padding: "5px 9px" }}>Reopen</Btn> : null}
              <Btn v="ghost" onClick={() => setStatus(assignment.id, "archived")} disabled={busy} style={{ fontSize: 11, padding: "5px 9px", color: C.dim }}>Archive</Btn>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

const selectStyle = { width: "100%", padding: "9px 10px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 7, color: C.txt, fontFamily: "inherit", fontSize: 12 };
const inputStyle = { ...selectStyle, marginTop: 4 };
const labelStyle = { fontSize: 10, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" };
const linkButton = { background: "none", border: "none", padding: 0, color: C.pri, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
