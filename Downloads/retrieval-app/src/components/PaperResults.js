"use client";
import { useState, useEffect } from "react";
import { sb, SUPA_URL } from "../lib/supabase";
import { workStatus } from "../lib/assignments";
import { C } from "../lib/theme";
import { Card } from "./ui";

export function PaperResults({ paperId, cls, onBack }) {
  const [paper, setPaper] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [responses, setResponses] = useState([]);
  const [members, setMembers] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const [sheets, setSheets] = useState([]);   // feedforward sheets generated for this paper
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    setLoading(true);
    try {
      const [p, qs, atts, mems, assignmentRows] = await Promise.all([
        sb.q("papers", { params: { id: `eq.${paperId}`, select: "*" } }),
        sb.q("paper_questions", { params: { paper_id: `eq.${paperId}`, select: "id,sort_order,question_label,marks", order: "sort_order.asc" } }),
        sb.q("paper_attempts", { params: { paper_id: `eq.${paperId}`, class_id: `eq.${cls.id}`, select: "*,profiles(display_name)" } }),
        sb.q("class_members", { params: { class_id: `eq.${cls.id}`, select: "student_id,profiles(display_name)" } }),
        sb.q("paper_class_assignments", { params: { paper_id: `eq.${paperId}`, class_id: `eq.${cls.id}`, select: "instructions,available_from,due_at,available_until,attempt_limit,published" } }),
      ]);
      setPaper(p[0]); setQuestions(qs || []); setAttempts(atts || []); setMembers(mems || []);
      setAssignment(assignmentRows?.[0] || null);
      // Feedforward sheets for this paper (resilient — older deploys lack the table).
      const fs = await sb.q("paper_feedforward_sheets", { params: { paper_id: `eq.${paperId}`, select: "*", order: "created_at.desc" } }).catch(() => []);
      setSheets(fs || []);
      if ((atts || []).length > 0) {
        const ids = atts.map(a => a.id);
        const filterStr = ids.map(id => `attempt_id.eq.${id}`).join(",");
        const rs = await sb.q("paper_responses", { params: { or: `(${filterStr})`, select: "*" } });
        setResponses(rs || []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  })(); }, [paperId, cls.id]);

  if (loading) return <div style={{ padding: 20, textAlign: "center", color: C.dim, fontSize: 12 }}>Loading…</div>;
  if (!paper) return <div style={{ padding: 20, textAlign: "center", color: C.red }}>Paper not found.</div>;

  const studentRows = members.map(m => {
    // Pick the LATEST submitted attempt for the headline mark, but also count
    // total submitted attempts so the teacher can see when a student has retaken.
    const submittedAttempts = attempts
      .filter(a => a.student_id === m.student_id && a.submitted_at)
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    const att = submittedAttempts[0];
    const latestAttempt = attempts
      .filter(a => a.student_id === m.student_id)
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
    const status = workStatus({
      completedAt: att?.submitted_at || null,
      dueAt: assignment?.due_at || null,
      started: !!latestAttempt,
    });
    return {
      id: m.student_id,
      name: m.profiles?.display_name || "?",
      attempt: att,
      attemptCount: submittedAttempts.length,
      submitted: !!att,
      status,
    };
  });
  const submittedRows = studentRows.filter(r => r.submitted);
  const missingRows = studentRows.filter(r => r.status.key === "missing");
  const avgPct = submittedRows.length === 0 ? 0 :
    Math.round(submittedRows.reduce((s, r) => s + ((r.attempt.awarded_marks ?? 0) / Math.max(1, r.attempt.total_marks ?? paper.total_marks)) * 100, 0) / submittedRows.length);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onBack} style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>← Paper</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{paper.name} — Results</div>
          <div style={{ fontSize: 11, color: C.dim }}>{cls.name} · {submittedRows.length}/{members.length} submitted{missingRows.length ? ` · ${missingRows.length} missing` : ""} · class average {avgPct}%</div>
        </div>
      </div>

      {sheets.length > 0 && (
        <Card style={{ padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 8 }}>Feedforward sheets</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sheets.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || "Feedforward sheet"}</div>
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                    {s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}
                    {s.class_id ? (s.class_id === cls.id ? " · this class" : " · class-specific") : " · general"}
                  </div>
                </div>
                <a href={`${SUPA_URL}/storage/v1/object/public/paper-uploads/${s.docx_path}`} target="_blank" rel="noreferrer"
                  style={{ flexShrink: 0, padding: "4px 10px", fontSize: 10, borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card2 || C.bg, color: C.mid, textDecoration: "none" }}>Download</a>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 8 }}>Generate more from the paper&apos;s Feedforward tab.</div>
        </Card>
      )}

      {studentRows.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 12, color: C.dim }}>No students in this class yet.</div></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {studentRows.map(r => {
            const pct = r.submitted ? Math.round(((r.attempt.awarded_marks ?? 0) / Math.max(1, r.attempt.total_marks ?? paper.total_marks)) * 100) : 0;
            const tone = pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red;
            const statusTone = r.status.key === "missing" || r.status.key === "late" || r.status.key === "completed_late" ? C.red : r.status.key === "completed" ? C.grn : C.dim;
            return (
              <Card key={r.id} style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: C.txt, fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{r.submitted ? `Submitted ${new Date(r.attempt.submitted_at).toLocaleDateString()}${r.attemptCount > 1 ? ` · ${r.attemptCount} attempts` : ""}` : r.status.label}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: statusTone }}>{r.status.label}</span>
                  {r.submitted ? (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: tone }}>{r.attempt.awarded_marks ?? 0}/{r.attempt.total_marks ?? paper.total_marks}</div>
                      <div style={{ fontSize: 11, color: C.dim }}>{pct}%</div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: C.dim, fontStyle: "italic" }}>—</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
