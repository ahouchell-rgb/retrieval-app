"use client";
import { useState, useEffect } from "react";
import { sb, SUPA_URL } from "../lib/supabase";
import { fromLocalInputValue, toLocalInputValue } from "../lib/assignments";
import { C } from "../lib/theme";
import { PaperResults } from "./PaperResults";
import { Btn, Card, Inp, Pill, TA } from "./ui";

export function PaperEditor({ user, paperId, classes, topics, onBack, onResults }) {
  const [paper, setPaper] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [section, setSection] = useState("questions"); // 'questions' | 'assign'
  const [loading, setLoading] = useState(true);
  const [editingQ, setEditingQ] = useState(null); // null | 'new' | <id>
  const [qDraft, setQDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  // Feedforward (upload-docx → feedforward) state.
  const [sheets, setSheets] = useState([]);
  const [ffStruggled, setFfStruggled] = useState([]); // selected paper_question ids
  const [ffNotes, setFfNotes] = useState("");
  const [ffFile, setFfFile] = useState(null);
  const [ffBusy, setFfBusy] = useState(false);
  // Phase 2 — parse an uploaded .docx into a tickable question list.
  const [uploadedPath, setUploadedPath] = useState(null); // cached source path once uploaded
  const [parsedQs, setParsedQs] = useState([]);           // questions read from the docx
  const [ffParsedSel, setFfParsedSel] = useState([]);     // selected indices into parsedQs
  const [parsing, setParsing] = useState(false);
  // Phase 3 — attach the sheet to a class + auto-suggest from that class's results.
  const [ffClassId, setFfClassId] = useState("");
  const [gapPct, setGapPct] = useState(null);    // { [paper_question_id]: pct } for the chosen class
  const [suggesting, setSuggesting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, qs, ass, fs] = await Promise.all([
        sb.q("papers", { params: { id: `eq.${paperId}`, select: "*" } }),
        sb.q("paper_questions", { params: { paper_id: `eq.${paperId}`, select: "*", order: "sort_order.asc" } }),
        sb.q("paper_class_assignments", { params: { paper_id: `eq.${paperId}`, select: "*" } }),
        // Resilient: an older deploy without the table shouldn't break the editor.
        sb.q("paper_feedforward_sheets", { params: { paper_id: `eq.${paperId}`, select: "*", order: "created_at.desc" } }).catch(() => []),
      ]);
      setPaper(p[0]);
      setQuestions(qs || []);
      setAssignments(ass || []);
      setSheets(fs || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const toggleStruggled = (id) => setFfStruggled(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleParsed = (i) => setFfParsedSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);

  // Phase 3: pick a class to attach the sheet to, and auto-suggest the questions
  // that class scored lowest on (from their marked results). Pre-ticks the weak ones.
  const SUGGEST_BELOW = 65; // % — pre-select questions the class averaged under this
  const pickClass = async (classId) => {
    setFfClassId(classId);
    setGapPct(null);
    if (!classId) return;
    setSuggesting(true);
    try {
      const rows = await sb.rpc("class_paper_question_gaps", { p_class_id: classId, p_paper_id: paperId });
      const map = {};
      (Array.isArray(rows) ? rows : []).forEach(r => { if (r?.paper_question_id != null) map[r.paper_question_id] = r.pct; });
      setGapPct(map);
      // Pre-tick the questions this class averaged below the threshold (additive — keep any manual ticks).
      const weak = Object.entries(map).filter(([, pct]) => Number(pct) < SUGGEST_BELOW).map(([id]) => id);
      if (weak.length) setFfStruggled(s => Array.from(new Set([...s, ...weak])));
    } catch (e) { console.error("suggest failed", e); }
    setSuggesting(false);
  };

  // Pick a file: reset any prior upload/parse so a new file isn't read from the old path.
  const chooseFile = (f) => { setFfFile(f); setUploadedPath(null); setParsedQs([]); setFfParsedSel([]); };

  // Upload the chosen file once, caching the path so parse + generate reuse it.
  const ensureUploaded = async () => {
    if (!ffFile) return null;
    if (uploadedPath) return uploadedPath;
    const safe = ffFile.name.replace(/[^\w.\-]+/g, "_");
    const path = await sb.uploadToBucket("paper-uploads", `${user.id}/source/${crypto.randomUUID()}-${safe}`, ffFile);
    setUploadedPath(path);
    return path;
  };

  // Phase 2: read the uploaded .docx into a tickable question list.
  const readPaper = async () => {
    if (!ffFile) { alert("Choose a Word (.docx) exam paper first."); return; }
    setParsing(true);
    try {
      const path = await ensureUploaded();
      const res = await sb.callParsePaper({ source_upload_path: path });
      const qs = Array.isArray(res?.questions) ? res.questions : [];
      setParsedQs(qs);
      setFfParsedSel([]);
      if (qs.length === 0) alert("Couldn't find any questions in that document — tick existing questions or type notes instead.");
    } catch (e) { alert("Couldn't read the paper: " + e.message); }
    setParsing(false);
  };

  const generateFeedforward = async () => {
    const parsedChosen = ffParsedSel.map(i => parsedQs[i]).filter(Boolean);
    if (ffStruggled.length === 0 && parsedChosen.length === 0 && !ffNotes.trim()) {
      alert("Tick the questions your class struggled with (or read them from an uploaded paper), or add a note."); return;
    }
    setFfBusy(true);
    try {
      const source_upload_path = await ensureUploaded();
      const res = await sb.callPaperFeedforward({
        paper_id: paperId,
        class_id: ffClassId || null,
        source_upload_path,
        struggled: { question_ids: ffStruggled, parsed: parsedChosen, notes: ffNotes.trim() },
      });
      setFfNotes(""); setFfStruggled([]); setFfFile(null);
      setUploadedPath(null); setParsedQs([]); setFfParsedSel([]);
      setFfClassId(""); setGapPct(null);
      await load();
      if (res?.url) window.open(res.url, "_blank");
    } catch (e) { alert("Generation failed: " + e.message); }
    setFfBusy(false);
  };

  const deleteSheet = async (sheet) => {
    if (!confirm("Delete this feedforward sheet?")) return;
    try { await sb.del("paper_feedforward_sheets", { id: `eq.${sheet.id}` }); await load(); }
    catch (e) { alert("Delete failed: " + e.message); }
  };

  // Regenerate a fresh sheet from a previous one's saved inputs, with an optional tweak.
  const regenerateSheet = async (sheet) => {
    const tweak = window.prompt("Regenerate this sheet. Add a tweak (optional) — e.g. “make it easier” or “add a diagram question”:", "");
    if (tweak === null) return; // cancelled
    setFfBusy(true);
    try {
      const si = sheet.struggled_input || {};
      const notes = [si.notes, tweak.trim()].filter(Boolean).join(" — ");
      const res = await sb.callPaperFeedforward({
        paper_id: paperId,
        class_id: sheet.class_id || null,
        source_upload_path: sheet.source_upload_path || null,
        struggled: { question_ids: si.question_ids || [], parsed: si.parsed || [], notes },
      });
      await load();
      if (res?.url) window.open(res.url, "_blank");
    } catch (e) { alert("Regenerate failed: " + e.message); }
    setFfBusy(false);
  };

  useEffect(() => { load(); }, [paperId]);

  const startNewQuestion = () => {
    setQDraft({
      question_label: "", question_text: "", command_word: "Explain", marks: 2,
      topic_id: "", image_url: "",
      marking_points: [{ text: "", marks: 1 }, { text: "", marks: 1 }],
    });
    setEditingQ("new");
  };

  const startEditQuestion = (q) => {
    setQDraft({
      question_label: q.question_label || "",
      question_text: q.question_text,
      command_word: q.command_word || "Explain",
      marks: q.marks || 1,
      topic_id: q.topic_id || "",
      image_url: q.image_url || "",
      marking_points: Array.isArray(q.marking_points) && q.marking_points.length > 0 ? q.marking_points : [{ text: "", marks: 1 }],
    });
    setEditingQ(q.id);
  };

  const updateMarkingPointsForMarks = (n) => {
    setQDraft(d => {
      const cur = d.marking_points || [];
      const next = [...cur];
      while (next.length < n) next.push({ text: "", marks: 1 });
      while (next.length > n) next.pop();
      return { ...d, marks: n, marking_points: next };
    });
  };

  const saveQuestion = async () => {
    if (!qDraft.question_text.trim()) return;
    // Filter out empty marking points; warn if all empty
    const cleanPoints = (qDraft.marking_points || []).filter(p => p.text && p.text.trim()).map(p => ({ text: p.text.trim(), marks: p.marks || 1 }));
    if (cleanPoints.length === 0) {
      if (!confirm("This question has no marking points. The AI marker won't be able to score it. Save anyway?")) return;
    }
    setBusy(true);
    try {
      const body = {
        question_label: qDraft.question_label.trim() || null,
        question_text: qDraft.question_text.trim(),
        command_word: qDraft.command_word || null,
        marks: qDraft.marks || 1,
        topic_id: qDraft.topic_id || null,
        image_url: qDraft.image_url || null,
        marking_points: cleanPoints,
      };
      if (editingQ === "new") {
        body.paper_id = paperId;
        body.sort_order = questions.length;
        await sb.q("paper_questions", { method: "POST", body });
      } else {
        await sb.q("paper_questions", { method: "PATCH", params: { id: `eq.${editingQ}` }, body });
      }
      setEditingQ(null);
      setQDraft(null);
      await load();
    } catch (e) { console.error(e); alert("Save failed: " + e.message); }
    setBusy(false);
  };

  const deleteQuestion = async (id) => {
    if (!confirm("Delete this question? Any responses students have already given to it will be removed.")) return;
    await sb.q("paper_questions", { method: "DELETE", params: { id: `eq.${id}` } });
    await load();
  };

  const toggleAssignment = async (classId) => {
    const isAssigned = assignments.some(a => a.class_id === classId);
    if (isAssigned) {
      await sb.q("paper_class_assignments", { method: "DELETE", params: { paper_id: `eq.${paperId}`, class_id: `eq.${classId}` } });
    } else {
      await sb.q("paper_class_assignments", { method: "POST", body: { paper_id: paperId, class_id: classId, published: true, attempt_limit: 1 } });
    }
    await load();
  };

  const editAssignment = (classId, patch) => {
    setAssignments(rows => rows.map(row => row.class_id === classId ? { ...row, ...patch } : row));
  };

  const saveAssignment = async (classId, patch) => {
    try {
      await sb.q("paper_class_assignments", { method: "PATCH", params: { paper_id: `eq.${paperId}`, class_id: `eq.${classId}` }, body: patch });
    } catch (e) { alert("Could not save assignment settings: " + e.message); await load(); }
  };

  if (loading) return <div style={{ padding: 20, textAlign: "center", color: C.dim, fontSize: 12 }}>Loading…</div>;
  if (!paper) return <div style={{ padding: 20, textAlign: "center", color: C.red }}>Paper not found.</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onBack} style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>
          ← Papers
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paper.name}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{questions.length} question{questions.length === 1 ? "" : "s"} · {paper.total_marks} marks</div>
        </div>
        <button onClick={onResults} style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card, color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>
          Results
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <Pill on={section === "questions"} onClick={() => setSection("questions")}>Questions</Pill>
        <Pill on={section === "assign"} onClick={() => setSection("assign")}>Assign to classes ({assignments.length})</Pill>
        <Pill on={section === "feedforward"} onClick={() => setSection("feedforward")}>Feedforward ({sheets.length})</Pill>
      </div>

      {section === "questions" && (
        <>
          {editingQ ? (
            <Card style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 10 }}>{editingQ === "new" ? "New question" : "Edit question"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <Inp placeholder="Label e.g. 1(a)" value={qDraft.question_label} onChange={e => setQDraft(d => ({ ...d, question_label: e.target.value }))} style={{ width: 100 }} />
                  <select value={qDraft.command_word} onChange={e => setQDraft(d => ({ ...d, command_word: e.target.value }))}
                    style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 13, flex: 1 }}>
                    {["State","Define","Describe","Explain","Calculate","Suggest","Evaluate","Compare"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Inp type="number" min={1} max={10} value={qDraft.marks} onChange={e => updateMarkingPointsForMarks(parseInt(e.target.value) || 1)} style={{ width: 70 }} />
                </div>
                <TA placeholder="Question text" value={qDraft.question_text} onChange={e => setQDraft(d => ({ ...d, question_text: e.target.value }))} rows={3} />
                <select value={qDraft.topic_id} onChange={e => setQDraft(d => ({ ...d, topic_id: e.target.value }))}
                  style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 13 }}>
                  <option value="">No topic (paper-only)</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Marking points (one per mark — what earns each mark)</div>
                  {qDraft.marking_points.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 22, height: 22, marginTop: 8, borderRadius: 99, background: C.card2, color: C.mid, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                      <TA placeholder={`Marking point ${i + 1} — what earns this mark?`} value={p.text} rows={2}
                        onChange={e => setQDraft(d => ({ ...d, marking_points: d.marking_points.map((mp, j) => j === i ? { ...mp, text: e.target.value } : mp) }))} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Btn onClick={saveQuestion} disabled={!qDraft.question_text.trim() || busy} style={{ flex: 1 }}>{editingQ === "new" ? "Add question" : "Save"}</Btn>
                  <Btn v="ghost" onClick={() => { setEditingQ(null); setQDraft(null); }} style={{ fontSize: 12 }}>Cancel</Btn>
                </div>
              </div>
            </Card>
          ) : (
            <Btn onClick={startNewQuestion} style={{ marginBottom: 12, padding: "8px 14px", fontSize: 12 }}>+ Add question</Btn>
          )}

          {questions.length === 0 ? (
            <Card style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.dim }}>No questions yet. Add the first one above.</div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {questions.map((q, i) => (
                <Card key={q.id} style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 28, fontSize: 11, color: C.mid, fontWeight: 700, marginTop: 2 }}>{q.question_label || `Q${i + 1}`}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.4 }}>{q.question_text}</div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {q.command_word && <span>{q.command_word}</span>}
                        <span>·</span>
                        <span>{q.marks} mark{q.marks === 1 ? "" : "s"}</span>
                        <span>·</span>
                        <span>{(q.marking_points || []).length} marking point{(q.marking_points || []).length === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => startEditQuestion(q)} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
                      <button onClick={() => deleteQuestion(q.id)} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.red}55`, background: "transparent", color: C.red, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {section === "assign" && (
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 10, lineHeight: 1.5 }}>Assign the paper, schedule its release, set the deadline and control how many attempts pupils get.</div>
          {classes.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>You don't have any classes yet.</div> :
            classes.map(c => {
              const assignment = assignments.find(a => a.class_id === c.id);
              const isAssigned = !!assignment;
              return (
                <div key={c.id} style={{ padding: "10px 12px", borderRadius: 8, background: isAssigned ? C.priSoft : C.card2, border: `1px solid ${isAssigned ? C.pri + "55" : C.bdr}`, marginBottom: 8 }}>
                  <button onClick={() => toggleAssignment(c.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isAssigned ? C.pri : C.bdr}`, background: isAssigned ? C.pri : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>{isAssigned ? "✓" : ""}</span>
                    <span style={{ flex: 1, fontSize: 13, color: C.txt, fontWeight: 600 }}>{c.name}{c.year_group ? ` (Y${c.year_group})` : ""}</span>
                    {isAssigned && <span style={{ fontSize: 10, color: assignment.published ? C.grn : C.dim }}>{assignment.published ? "Live" : "Draft"}</span>}
                  </button>
                  {assignment && (
                    <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.bdrSoft}` }}>
                      <textarea value={assignment.instructions || ""} rows={2} maxLength={2000} placeholder="Instructions for pupils (optional)"
                        onChange={e => editAssignment(c.id, { instructions: e.target.value })}
                        onBlur={e => saveAssignment(c.id, { instructions: e.target.value.trim() })}
                        style={{ width: "100%", resize: "vertical", padding: "8px 9px", border: `1px solid ${C.bdr}`, borderRadius: 6, background: C.card, color: C.txt, fontSize: 11, fontFamily: "inherit", boxSizing: "border-box" }} />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 92px", gap: 7, marginTop: 8 }}>
                        <label style={assignmentLabel}>Release<input type="datetime-local" value={toLocalInputValue(assignment.available_from)} onChange={e => editAssignment(c.id, { available_from: fromLocalInputValue(e.target.value) })} onBlur={e => saveAssignment(c.id, { available_from: fromLocalInputValue(e.target.value) })} style={assignmentInput} /></label>
                        <label style={assignmentLabel}>Due<input type="datetime-local" value={toLocalInputValue(assignment.due_at)} onChange={e => editAssignment(c.id, { due_at: fromLocalInputValue(e.target.value) })} onBlur={e => saveAssignment(c.id, { due_at: fromLocalInputValue(e.target.value) })} style={assignmentInput} /></label>
                        <label style={assignmentLabel}>Closes<input type="datetime-local" value={toLocalInputValue(assignment.available_until)} onChange={e => editAssignment(c.id, { available_until: fromLocalInputValue(e.target.value) })} onBlur={e => saveAssignment(c.id, { available_until: fromLocalInputValue(e.target.value) })} style={assignmentInput} /></label>
                        <label style={assignmentLabel}>Attempts<select value={assignment.attempt_limit || 1} onChange={e => { const value = Number(e.target.value); editAssignment(c.id, { attempt_limit: value }); saveAssignment(c.id, { attempt_limit: value }); }} style={assignmentInput}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                      </div>
                      <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 9, color: C.mid, fontSize: 11, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!assignment.published} onChange={e => { editAssignment(c.id, { published: e.target.checked }); saveAssignment(c.id, { published: e.target.checked }); }} />
                        Published — pupils can see it once the release time arrives
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
        </Card>
      )}

      {section === "feedforward" && (
        <>
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 6 }}>Generate a feedforward sheet</div>
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 12, lineHeight: 1.5 }}>
              Tick the questions your class struggled with (and/or add a note). I&apos;ll build a one-page practice
              sheet in the standard style — fresh parallel questions scaffolded down from those topics — as a Word document.
            </div>

            {classes && classes.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>For a class (optional — I&apos;ll pre-select what they scored lowest on)</div>
                <select value={ffClassId} onChange={e => pickClass(e.target.value)}
                  style={{ padding: "8px 10px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 12, width: "100%" }}>
                  <option value="">Not class-specific</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.year_group ? ` (Y${c.year_group})` : ""}</option>)}
                </select>
                {suggesting && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Reading this class&apos;s results…</div>}
                {gapPct && !suggesting && (
                  <div style={{ fontSize: 10, color: C.mid, marginTop: 4 }}>
                    {Object.keys(gapPct).length === 0
                      ? "No marked results for this class yet — tick the questions manually."
                      : "Pre-selected the questions this class scored lowest on — adjust as needed."}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Exam paper (optional — upload a .docx and I&apos;ll read its questions)</div>
              <input type="file" accept=".docx,.doc,application/pdf,image/*" onChange={e => chooseFile(e.target.files?.[0] || null)} style={{ fontSize: 12, color: C.mid }} />
              {ffFile && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: C.dim }}>{ffFile.name}</span>
                  {/\.(docx?|pdf|png|jpe?g|webp|gif)$/i.test(ffFile.name) && (
                    <Btn v="ghost" onClick={readPaper} disabled={parsing} style={{ fontSize: 11, padding: "5px 10px" }}>
                      {parsing ? "Reading…" : parsedQs.length ? "Re-read questions" : "Read questions from this paper"}
                    </Btn>
                  )}
                </div>
              )}
            </div>

            {parsedQs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Questions found in your paper — tick the ones they struggled with</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {parsedQs.map((q, i) => {
                    const on = ffParsedSel.includes(i);
                    return (
                      <div key={i} onClick={() => toggleParsed(i)}
                        style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: on ? C.priSoft : C.card2, border: `1px solid ${on ? C.pri + "55" : C.bdr}`, cursor: "pointer" }}>
                        <div style={{ width: 16, height: 16, marginTop: 2, borderRadius: 4, border: `2px solid ${on ? C.pri : C.bdr}`, background: on ? C.pri : "transparent", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginRight: 6 }}>{q.label ? `Q${q.label}` : `Q${i + 1}`}{q.marks ? ` · ${q.marks}m` : ""}</span>
                          <span style={{ fontSize: 11, color: C.txt }}>{q.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {questions.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Questions the class struggled with</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {questions.map((q, i) => {
                    const on = ffStruggled.includes(q.id);
                    return (
                      <div key={q.id} onClick={() => toggleStruggled(q.id)}
                        style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: on ? C.priSoft : C.card2, border: `1px solid ${on ? C.pri + "55" : C.bdr}`, cursor: "pointer" }}>
                        <div style={{ width: 16, height: 16, marginTop: 2, borderRadius: 4, border: `2px solid ${on ? C.pri : C.bdr}`, background: on ? C.pri : "transparent", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginRight: 6 }}>{q.question_label || `Q${i + 1}`}</span>
                          {gapPct && gapPct[q.id] != null && (
                            <span style={{ fontSize: 10, fontWeight: 700, marginRight: 6, color: gapPct[q.id] < 50 ? C.red : gapPct[q.id] < 70 ? (C.amb || C.mid) : C.grn }}>{gapPct[q.id]}%</span>
                          )}
                          <span style={{ fontSize: 11, color: C.txt }}>{q.question_text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <TA placeholder="Notes — what did they get wrong? e.g. 'muddled osmosis and diffusion; couldn't link enzyme shape to temperature'" value={ffNotes} onChange={e => setFfNotes(e.target.value)} rows={3} />

            <Btn onClick={generateFeedforward} disabled={ffBusy} style={{ marginTop: 10, padding: "8px 14px", fontSize: 12 }}>{ffBusy ? "Generating…" : "Generate feedforward sheet"}</Btn>
          </Card>

          {sheets.length === 0 ? (
            <Card style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 12, color: C.dim }}>No feedforward sheets yet.</div></Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sheets.map(s => (
                <Card key={s.id} style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.txt, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || "Feedforward sheet"}</div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</div>
                    </div>
                    <a href={`${SUPA_URL}/storage/v1/object/public/paper-uploads/${s.docx_path}`} target="_blank" rel="noreferrer"
                      style={{ padding: "4px 10px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card, color: C.mid, textDecoration: "none" }}>Download</a>
                    <button onClick={() => regenerateSheet(s)} disabled={ffBusy} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: ffBusy ? "default" : "pointer", fontFamily: "inherit" }}>Regenerate</button>
                    <button onClick={() => deleteSheet(s)} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.red}55`, background: "transparent", color: C.red, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const assignmentLabel = { fontSize: 9, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" };
const assignmentInput = { display: "block", width: "100%", marginTop: 4, padding: "6px 7px", border: `1px solid ${C.bdr}`, borderRadius: 6, background: C.card, color: C.txt, fontSize: 10, fontFamily: "inherit", boxSizing: "border-box" };

/* ─── PaperResults — per-student results table for a paper ─── */
