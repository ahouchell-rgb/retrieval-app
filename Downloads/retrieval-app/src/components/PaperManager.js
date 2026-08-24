"use client";
import { useState, useEffect } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { PaperEditor } from "./PaperEditor";
import { PaperResults } from "./PaperResults";
import { Btn, Card, Inp } from "./ui";
import { useFeedback } from "./Feedback";

export function PaperManager({ user, cls, classes, topics, subjectId }) {
  const { confirm, notify } = useFeedback();
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // 'list' | 'paper' | 'results'
  const [selectedPaperId, setSelectedPaperId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", exam_board: "", paper_year: "", paper_number: "" });
  const [busy, setBusy] = useState(false);

  const loadPapers = async () => {
    setLoading(true);
    try {
      const rows = await sb.q("papers", { params: {
        teacher_id: `eq.${user.id}`, archived: "eq.false",
        select: "*,paper_questions(count),paper_class_assignments(class_id)",
        order: "updated_at.desc"
      }});
      setPapers(rows || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadPapers(); }, []);

  const createPaper = async () => {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      const body = {
        teacher_id: user.id, subject_id: subjectId,
        name: draft.name.trim(),
        exam_board: draft.exam_board.trim() || null,
        paper_year: draft.paper_year ? parseInt(draft.paper_year) : null,
        paper_number: draft.paper_number.trim() || null,
      };
      const [p] = await sb.q("papers", { method: "POST", body });
      setCreating(false);
      setDraft({ name: "", exam_board: "", paper_year: "", paper_number: "" });
      setSelectedPaperId(p.id);
      setView("paper");
      await loadPapers();
    } catch (e) { console.error(e); notify("Could not create the paper. " + e.message, { title: "Paper not created" }); }
    setBusy(false);
  };

  const archivePaper = async (id) => {
    const approved = await confirm({ title: "Archive this paper?", message: "Pupils will no longer see it. The paper can still be restored from the database if needed.", confirmLabel: "Archive paper" });
    if (!approved) return;
    await sb.q("papers", { method: "PATCH", params: { id: `eq.${id}` }, body: { archived: true } });
    await loadPapers();
  };

  if (view === "paper" && selectedPaperId) {
    return <PaperEditor user={user} paperId={selectedPaperId} classes={classes} topics={topics} onBack={() => { setView("list"); setSelectedPaperId(null); loadPapers(); }} onResults={() => setView("results")} />;
  }
  if (view === "results" && selectedPaperId) {
    return <PaperResults paperId={selectedPaperId} cls={cls} onBack={() => setView("paper")} />;
  }

  // ── List view ──
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>Past papers & mocks</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Build exam-style assessments with mark schemes. Assign to classes. AI marks each answer.</div>
        </div>
        <Btn onClick={() => setCreating(true)} style={{ padding: "8px 14px", fontSize: 12 }}>+ New paper</Btn>
      </div>

      {creating && (
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 10 }}>Create a paper</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Inp placeholder="Name (e.g. Y10 Autumn Mock — Biology Paper 1)" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <Inp placeholder="Exam board (e.g. AQA)" value={draft.exam_board} onChange={e => setDraft(d => ({ ...d, exam_board: e.target.value }))} style={{ flex: 1 }} />
              <Inp type="number" placeholder="Year" value={draft.paper_year} onChange={e => setDraft(d => ({ ...d, paper_year: e.target.value }))} style={{ width: 90 }} />
              <Inp placeholder="Paper #" value={draft.paper_number} onChange={e => setDraft(d => ({ ...d, paper_number: e.target.value }))} style={{ width: 110 }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn onClick={createPaper} disabled={!draft.name.trim() || busy} style={{ flex: 1 }}>Create</Btn>
              <Btn v="ghost" onClick={() => { setCreating(false); setDraft({ name: "", exam_board: "", paper_year: "", paper_number: "" }); }} style={{ fontSize: 12 }}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {loading ? <div style={{ padding: 20, color: C.dim, fontSize: 12, textAlign: "center" }}>Loading…</div>
       : papers.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center" }}>
          <div style={{ marginBottom: 8, opacity: 0.4, display: "flex", justifyContent: "center" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg></div>
          <div style={{ fontSize: 13, color: C.txt, fontWeight: 600, marginBottom: 4 }}>No papers yet</div>
          <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>Build a mock paper or recreate a real exam paper. Add questions with mark schemes — the AI marks against them automatically.</div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {papers.map(p => {
            const qCount = p.paper_questions?.[0]?.count ?? 0;
            const classCount = p.paper_class_assignments?.length ?? 0;
            const meta = [p.exam_board, p.paper_year, p.paper_number].filter(Boolean).join(" · ");
            return (
              <Card key={p.id} style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => { setSelectedPaperId(p.id); setView("paper"); }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{p.name}</div>
                    {meta && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{meta}</div>}
                    <div style={{ fontSize: 10, color: C.mid, marginTop: 4, display: "flex", gap: 8 }}>
                      <span>{qCount} question{qCount === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{p.total_marks} marks</span>
                      <span>·</span>
                      <span>{classCount === 0 ? "Not assigned" : `${classCount} class${classCount === 1 ? "" : "es"}`}</span>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); archivePaper(p.id); }}
                    style={{ padding: "4px 8px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.dim, cursor: "pointer", fontFamily: "inherit" }}>
                    Archive
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── PaperEditor — manage a single paper: questions, assignments, results ─── */
