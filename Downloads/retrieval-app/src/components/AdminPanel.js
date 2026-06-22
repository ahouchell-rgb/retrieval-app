"use client";
import { useState, useEffect } from "react";
import { SUPA_KEY, SUPA_URL, sb } from "../lib/supabase";
import { isStudent, isTeacher } from "../lib/roles";
import { C } from "../lib/theme";
import { Teacher } from "./Teacher";
import { CostDashboard } from "./CostDashboard";
import { FunnelDashboard } from "./FunnelDashboard";
import { SchoolsPanel } from "./SchoolsPanel";
import { Badge, Btn, Headline, Inp, Pill, Stat, StatTile } from "./ui";

export function AdminPanel({ user }) {
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [classMembers, setClassMembers] = useState([]);
  const [responses30d, setResponses30d] = useState([]);
  // AI usage logging — populated lazily when the "AI usage" tab is opened
  const [aiUsage, setAiUsage] = useState(null); // null = not loaded, [] = loaded empty
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiUsageWindow, setAiUsageWindow] = useState(7); // days
  // Cache health view
  const [cacheRows, setCacheRows] = useState(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cachePurging, setCachePurging] = useState(null); // id being purged
  const [filter, setFilter] = useState("");
  const [view, setView] = useState("overview"); // overview | teachers | students | unjoined
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pwDraft, setPwDraft] = useState("");
  const [pwTeacher, setPwTeacher] = useState(null); // {id, pw} — admin password-reset for a teacher
  const [addClassId, setAddClassId] = useState(""); // selected class in the student's "Add to class" dropdown
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ email: "", display_name: "", password: "" });
  // In-app support tickets (Support tab). openCount drives the tab's flag badge.
  const [tickets, setTickets] = useState(null);   // null = not loaded
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => { loadAll(); }, []);

  // Lazy-load the full ticket list when the Support tab is first opened.
  useEffect(() => { if (view === "support" && tickets === null) loadTickets(); /* eslint-disable-next-line */ }, [view]);

  const loadTickets = async () => {
    try {
      const t = await sb.q("support_tickets", { params: { select: "*", order: "created_at.desc" } });
      setTickets(t || []);
      setOpenCount((t || []).filter(x => x.status === "open").length);
    } catch (e) { setTickets([]); setMsg("Support tickets unavailable — has migration 07 been applied? " + e.message); }
  };

  const resolveTicket = async (id, status) => {
    try {
      await sb.q("support_tickets", { method: "PATCH", params: { id: `eq.${id}` }, body: { status, resolved_at: status === "resolved" ? new Date().toISOString() : null } });
      setTickets(ts => (ts || []).map(t => t.id === id ? { ...t, status } : t));
      setOpenCount(c => status === "resolved" ? Math.max(0, c - 1) : c + 1);
    } catch (e) { setMsg("Error: " + e.message); }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      // Pull only responses from the last ~31 days; we only need answered_at + class_id for costs.
      const cutoff = new Date(Date.now() - 31 * 86400000).toISOString();
      const [profs, clss, mems, resps] = await Promise.all([
        sb.q("profiles", { params: { select: "*", order: "created_at.desc" } }),
        sb.q("classes", { params: { select: "*,profiles!classes_teacher_id_fkey(display_name,email)", order: "created_at.desc" } }),
        sb.q("class_members", { params: { select: "class_id,student_id" } }),
        sb.qAll("responses", { params: { select: "class_id,answered_at", answered_at: `gte.${cutoff}`, order: "answered_at.desc" } }),
      ]);
      setTeachers(profs.filter(isTeacher));
      setStudents(profs.filter(isStudent));
      setClasses(clss);
      setClassMembers(mems);
      setResponses30d(resps || []);
      // Open-support-ticket flag for the Support tab (table may not exist pre-migration).
      try { const ot = await sb.q("support_tickets", { params: { status: "eq.open", select: "id" } }); setOpenCount((ot || []).length); } catch { /* migration 07 not applied yet */ }
    } catch (e) { console.error(e); setMsg("Error loading: " + e.message); }
    setLoading(false);
  };

  const callManage = async (action, studentId, extra = {}) => {
    setBusy(true); setMsg("");
    try {
      const jwt = sb.auth.getToken();
      const r = await fetch(`${SUPA_URL}/functions/v1/manage-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${jwt || SUPA_KEY}` },
        body: JSON.stringify({ action, student_id: studentId, ...extra }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg("✓ " + d.message);
        await loadAll();
        if (action === "delete_student") setExpandedStudent(null);
      } else {
        setMsg("Error: " + (d.error || "Unknown error"));
      }
    } catch (e) { setMsg("Error: " + e.message); }
    setBusy(false);
  };

  // GDPR data-subject export: download all of one pupil's data as JSON.
  const exportStudentData = async (s) => {
    setBusy(true); setMsg("");
    try {
      const data = await sb.rpc("export_student_data", { p_student: s.id });
      if (!data) { setMsg("Error: not authorised, or this needs migration 09 applied."); setBusy(false); return; }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(s.display_name || "pupil").replace(/[^a-z0-9_-]+/gi, "_")}_data_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setMsg("✓ Pupil data exported.");
    } catch (e) { setMsg("Error: " + e.message); }
    setBusy(false);
  };

  const studentClassMap = {};
  classMembers.forEach(m => {
    if (!studentClassMap[m.student_id]) studentClassMap[m.student_id] = [];
    studentClassMap[m.student_id].push(m.class_id);
  });
  const classById = Object.fromEntries(classes.map(c => [c.id, c]));
  const unjoinedStudents = students.filter(s => !studentClassMap[s.id] || studentClassMap[s.id].length === 0);

  const studentsForTeacher = (teacherId) => {
    const tClassIds = new Set(classes.filter(c => c.teacher_id === teacherId).map(c => c.id));
    return students.filter(s => (studentClassMap[s.id] || []).some(cid => tClassIds.has(cid)));
  };

  const filteredStudents = students.filter(s => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (s.display_name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q);
  });
  const filteredTeachers = teachers.filter(t => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (t.display_name || "").toLowerCase().includes(q) || (t.email || "").toLowerCase().includes(q);
  });

  if (loading) return <div style={{ maxWidth: 700, margin: "0 auto", padding: 40, textAlign: "center", color: C.mid }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 16, padding: "16px 20px", background: `linear-gradient(135deg, ${C.priSoft}, transparent)`, border: `1px solid ${C.pri}33`, borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.pri, marginBottom: 4 }}>Moderator panel</div>
        <div style={{ fontSize: 12, color: C.mid }}>You can see every teacher and student across Feynman Education. Only ahouchell@gmail.com has this access.</div>
      </div>

      {/* Overview stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
        <StatTile label="Teachers" value={teachers.length} onClick={() => setView("teachers")} active={view === "teachers"} />
        <StatTile label="Students" value={students.length} onClick={() => setView("students")} active={view === "students"} />
        <StatTile label="Classes" value={classes.length} />
        <StatTile label="Unjoined" value={unjoinedStudents.length} onClick={() => setView("unjoined")} active={view === "unjoined"} color={unjoinedStudents.length > 0 ? C.red : C.mid} />
      </div>

      {/* View tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
        {[{ k: "overview", l: "Overview" }, { k: "teachers", l: "All teachers" }, { k: "students", l: "All students" }, { k: "unjoined", l: `Unjoined${unjoinedStudents.length > 0 ? ` (${unjoinedStudents.length})` : ""}` }, { k: "support", l: `Support${openCount > 0 ? ` (${openCount})` : ""}` }, { k: "schools", l: "Schools & plans" }, { k: "costs", l: "Costs" }, { k: "funnel", l: "Booklet funnel" }, { k: "aiusage", l: "AI usage" }, { k: "cache", l: "Cache health" }].map(t => (
          <Pill key={t.k} on={view === t.k} onClick={() => setView(t.k)} style={{ fontSize: 12, padding: "6px 12px" }}>{t.l}</Pill>
        ))}
      </div>

      {msg && <div style={{ padding: "8px 12px", borderRadius: 8, background: msg.startsWith("Error") ? C.redS : C.priSoft, color: msg.startsWith("Error") ? C.red : C.pri, fontSize: 12, marginBottom: 12 }}>{msg}</div>}

      {/* Create teacher */}
      <div style={{ marginBottom: 16 }}>
        {!showCreateTeacher ? (
          <Btn v="ghost" onClick={() => { setShowCreateTeacher(true); setMsg(""); }} style={{ width: "100%", fontSize: 12, padding: "10px" }}>+ Create teacher account</Btn>
        ) : (
          <div style={{ padding: 14, background: C.card, border: `1px solid ${C.pri}33`, borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.pri, marginBottom: 10 }}>Create teacher account</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              <Inp placeholder="Full name" value={newTeacher.display_name} onChange={e => setNewTeacher(p => ({ ...p, display_name: e.target.value }))} style={{ fontSize: 13, padding: "8px 10px" }} />
              <Inp placeholder="Email" type="email" value={newTeacher.email} onChange={e => setNewTeacher(p => ({ ...p, email: e.target.value }))} style={{ fontSize: 13, padding: "8px 10px" }} />
              <Inp placeholder="Temporary password (min 6)" type="text" value={newTeacher.password} onChange={e => setNewTeacher(p => ({ ...p, password: e.target.value }))} style={{ fontSize: 13, padding: "8px 10px" }} />
            </div>
            <div style={{ fontSize: 11, color: C.mid, marginBottom: 10 }}>They can log in immediately and change the password in their own settings. Only tell them the password in person or through a trusted channel.</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn onClick={async () => {
                  const { email, display_name, password } = newTeacher;
                  if (!email.trim() || !display_name.trim() || !password.trim()) { setMsg("Error: all fields required"); return; }
                  if (password.length < 6) { setMsg("Error: password must be at least 6 characters"); return; }
                  setBusy(true); setMsg("");
                  try {
                    const jwt = sb.auth.getToken();
                    const r = await fetch(`${SUPA_URL}/functions/v1/manage-student`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${jwt || SUPA_KEY}` },
                      body: JSON.stringify({ action: "create_teacher", new_email: email, new_display_name: display_name, new_password: password }),
                    });
                    const d = await r.json();
                    if (d.success) {
                      setMsg(`✓ Teacher account created. Tell ${display_name} to log in with ${email} and change password.`);
                      setNewTeacher({ email: "", display_name: "", password: "" });
                      setShowCreateTeacher(false);
                      await loadAll();
                    } else {
                      setMsg("Error: " + (d.error || "Unknown"));
                    }
                  } catch (e) { setMsg("Error: " + e.message); }
                  setBusy(false);
                }} disabled={busy} style={{ flex: 1, fontSize: 12 }}>{busy ? "Creating..." : "Create account"}</Btn>
              <Btn v="ghost" onClick={() => { setShowCreateTeacher(false); setMsg(""); }} disabled={busy} style={{ fontSize: 12 }}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>

      {/* Overview */}
      {view === "overview" && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.mid, textTransform: "uppercase", letterSpacing: .5, marginBottom: 8 }}>Teachers at a glance</div>
          {teachers.map(t => {
            const tClasses = classes.filter(c => c.teacher_id === t.id);
            const tStudents = studentsForTeacher(t.id);
            return (
              <div key={t.id} style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{t.display_name || "—"}</span>
                      {t.role === "moderator" && <Badge color={C.pri} style={{ fontSize: 9 }}>MOD</Badge>}
                      {t.role === "hod" && <Badge color={C.amb} style={{ fontSize: 9 }}>HoD</Badge>}
                    </div>
                    <div style={{ fontSize: 11, color: C.mid, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.email}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: C.mid }}>
                    <div>{tClasses.length} class{tClasses.length === 1 ? "" : "es"}</div>
                    <div>{tStudents.length} student{tStudents.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                {tClasses.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                    {tClasses.map(c => <Badge key={c.id} color={C.mid} style={{ fontSize: 10 }}>{c.name}</Badge>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Teachers list with search */}
      {view === "teachers" && (
        <div>
          <Inp placeholder="Search teachers by name or email" value={filter} onChange={e => setFilter(e.target.value)} style={{ marginBottom: 10 }} />
          {filteredTeachers.map(t => {
            const tClasses = classes.filter(c => c.teacher_id === t.id);
            const isHoD = t.role === "hod";
            const isMod = t.role === "moderator";
            const teamCount = teachers.filter(x => x.hod_id === t.id).length;
            const assignedHoD = t.hod_id ? teachers.find(h => h.id === t.hod_id) : null;
            const hods = teachers.filter(x => x.role === "hod");
            return (
              <div key={t.id} style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {t.display_name || "—"}
                      {isMod && <Badge color={C.pri} style={{ fontSize: 9 }}>MOD</Badge>}
                      {isHoD && <Badge color={C.amb} style={{ fontSize: 9 }}>HoD · {teamCount}</Badge>}
                    </div>
                    <div style={{ fontSize: 11, color: C.mid, fontFamily: "monospace" }}>{t.email}</div>
                  </div>
                  <Btn v="ghost" onClick={() => { navigator.clipboard.writeText(t.email || ""); setMsg("Email copied"); setTimeout(() => setMsg(""), 1500); }} style={{ fontSize: 11, padding: "6px 10px" }}>Copy email</Btn>
                </div>
                {tClasses.length > 0 && (
                  <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>
                    Classes: {tClasses.map(c => c.name).join(", ")}
                  </div>
                )}

                {/* HoD controls (moderators only can't self-modify, handle on teacher and hod roles) */}
                {!isMod && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.bdr}`, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {isHoD ? (
                      <>
                        <Btn v="ghost" onClick={() => { if (confirm(`Demote ${t.display_name} from HoD back to teacher?`)) callManage("set_hod", t.id, { target_id: t.id, promote: false }); }} disabled={busy} style={{ fontSize: 11, padding: "5px 10px", color: C.red, borderColor: "rgba(239,68,68,.3)" }}>
                          Demote HoD
                        </Btn>
                        <span style={{ fontSize: 11, color: C.mid }}>{teamCount} teacher{teamCount === 1 ? "" : "s"} in dept</span>
                      </>
                    ) : (
                      <>
                        <Btn v="ghost" onClick={() => callManage("set_hod", t.id, { target_id: t.id, promote: true })} disabled={busy} style={{ fontSize: 11, padding: "5px 10px", color: C.amb, borderColor: "rgba(217,119,6,.3)" }}>
                          Promote to HoD
                        </Btn>
                        {assignedHoD ? (
                          <span style={{ fontSize: 11, color: C.mid, display: "flex", alignItems: "center", gap: 4 }}>
                            → {assignedHoD.display_name}'s dept
                            <Btn v="ghost" onClick={() => callManage("set_hod_link", t.id, { target_id: t.id, hod_id: null })} disabled={busy} style={{ fontSize: 10, padding: "3px 8px" }}>Remove</Btn>
                          </span>
                        ) : hods.length > 0 ? (
                          <select onChange={e => { if (e.target.value) { callManage("set_hod_link", t.id, { target_id: t.id, hod_id: e.target.value }); e.target.value = ""; } }} defaultValue="" style={{ padding: "5px 8px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.card, fontFamily: "inherit", cursor: "pointer" }}>
                            <option value="">Assign to HoD…</option>
                            {hods.map(h => <option key={h.id} value={h.id}>{h.display_name}</option>)}
                          </select>
                        ) : null}
                      </>
                    )}
                  </div>
                )}

                {/* Admin (moderator) actions — reset password / delete the account */}
                {!isMod && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.bdr}`, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {pwTeacher?.id === t.id ? (
                      <>
                        <Inp placeholder="New password (min 6)" type="text" value={pwTeacher.pw} onChange={e => setPwTeacher({ id: t.id, pw: e.target.value })} style={{ fontSize: 12, padding: "6px 10px", flex: 1, minWidth: 150 }} />
                        <Btn onClick={() => { callManage("reset_teacher_password", null, { teacher_id: t.id, new_password: pwTeacher.pw }); setPwTeacher(null); }} disabled={busy || (pwTeacher.pw || "").length < 6} style={{ fontSize: 11, padding: "6px 12px" }}>{busy ? "…" : "Set password"}</Btn>
                        <Btn v="ghost" onClick={() => setPwTeacher(null)} style={{ fontSize: 11, padding: "6px 10px" }}>Cancel</Btn>
                      </>
                    ) : (
                      <>
                        <Btn v="ghost" onClick={() => setPwTeacher({ id: t.id, pw: "" })} disabled={busy} style={{ fontSize: 11, padding: "5px 10px" }}>Reset password</Btn>
                        <Btn v="ghost" onClick={() => { if (confirm(`Permanently delete ${t.display_name || t.email}? This deletes their account and ${tClasses.length} class${tClasses.length === 1 ? "" : "es"} (pupils' accounts are kept). This cannot be undone.`)) callManage("delete_teacher", null, { teacher_id: t.id }); }} disabled={busy} style={{ fontSize: 11, padding: "5px 10px", color: C.red, borderColor: "rgba(239,68,68,.3)" }}>Delete account</Btn>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredTeachers.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.mid, fontSize: 12 }}>No teachers match.</div>}
        </div>
      )}

      {/* Students list with search */}
      {(view === "students" || view === "unjoined") && (
        <div>
          <Inp placeholder="Search students by name or email" value={filter} onChange={e => setFilter(e.target.value)} style={{ marginBottom: 10 }} />
          {(view === "unjoined" ? unjoinedStudents.filter(s => !filter || (s.display_name || "").toLowerCase().includes(filter.toLowerCase()) || (s.email || "").toLowerCase().includes(filter.toLowerCase())) : filteredStudents).map(s => {
            const isExpanded = expandedStudent === s.id;
            const sClassIds = studentClassMap[s.id] || [];
            const sClasses = sClassIds.map(id => classById[id]).filter(Boolean);
            const unjoined = sClasses.length === 0;
            return (
              <div key={s.id} style={{ background: C.card, border: `1px solid ${unjoined ? C.red + "55" : C.bdr}`, borderRadius: 8, marginBottom: 4 }}>
                <button onClick={() => { setExpandedStudent(isExpanded ? null : s.id); setRenameDraft(s.display_name || ""); setPwDraft(""); setMsg(""); }}
                  style={{ width: "100%", padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{s.display_name || "—"}</div>
                    <div style={{ fontSize: 11, color: C.mid, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email || "no email"}</div>
                  </div>
                  {unjoined ? <Badge color={C.red}>No class</Badge> : <div style={{ fontSize: 11, color: C.mid }}>{sClasses.map(c => c.name).join(", ")}</div>}
                  <span style={{ fontSize: 14, color: C.mid }}>{isExpanded ? "−" : "+"}</span>
                </button>
                {isExpanded && (
                  <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.bdr}`, background: C.cardSoft || C.bg }}>
                    {/* Rename */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 4 }}>Display name</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Inp value={renameDraft} onChange={e => setRenameDraft(e.target.value)} maxLength={80} style={{ fontSize: 13, padding: "8px 10px" }} />
                        <Btn onClick={() => { const t = renameDraft.trim(); if (t && t !== s.display_name) callManage("rename_student", s.id, { new_name: t }); }} disabled={busy || !renameDraft.trim() || renameDraft.trim() === s.display_name} style={{ whiteSpace: "nowrap", fontSize: 12, padding: "8px 14px" }}>{busy ? "..." : "Save"}</Btn>
                      </div>
                    </div>

                    {/* Reset password */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 4 }}>Reset password</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Inp placeholder="New password (min 6)" type="text" value={pwDraft} onChange={e => setPwDraft(e.target.value)} style={{ fontSize: 13, padding: "8px 10px" }} />
                        <Btn onClick={() => callManage("reset_password", s.id, { new_password: pwDraft })} disabled={pwDraft.length < 6 || busy} style={{ whiteSpace: "nowrap", fontSize: 12, padding: "8px 14px" }}>{busy ? "..." : "Reset"}</Btn>
                      </div>
                    </div>

                    {/* Email */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 4 }}>Login email</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ flex: 1, padding: "8px 10px", background: C.bg, border: `1px solid ${C.bdr}`, borderRadius: 6, fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email || "no email"}</div>
                        <Btn v="ghost" onClick={() => { navigator.clipboard.writeText(s.email || ""); setMsg("Email copied"); setTimeout(() => setMsg(""), 1500); }} style={{ fontSize: 11, padding: "8px 12px" }}>Copy</Btn>
                      </div>
                    </div>

                    {/* Add to class */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 4 }}>Add to class</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <select value={expandedStudent === s.id ? addClassId : ""} onChange={e => setAddClassId(e.target.value)} style={{ flex: 1, padding: "8px 10px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 6, fontSize: 13, fontFamily: "inherit", color: C.txt, cursor: "pointer" }}>
                          <option value="">Select a class...</option>
                          {classes.filter(c => !(studentClassMap[s.id] || []).includes(c.id)).map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.profiles?.display_name ? ` (${c.profiles.display_name})` : ""}</option>
                          ))}
                        </select>
                        <Btn onClick={() => { if (addClassId) { callManage("add_to_class", s.id, { class_id: addClassId }); setAddClassId(""); } }} disabled={!addClassId || busy} style={{ whiteSpace: "nowrap", fontSize: 12, padding: "8px 14px" }}>{busy ? "..." : "Add"}</Btn>
                      </div>
                      {classes.filter(c => !(studentClassMap[s.id] || []).includes(c.id)).length === 0 && (
                        <div style={{ fontSize: 11, color: C.mid, marginTop: 4, fontStyle: "italic" }}>In all available classes already.</div>
                      )}
                    </div>

                    {/* Remove from current classes */}
                    {(studentClassMap[s.id] || []).length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 4 }}>Remove from class</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {(studentClassMap[s.id] || []).map(cid => {
                            const cl = classById[cid];
                            if (!cl) return null;
                            return (
                              <div key={cid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.bg, border: `1px solid ${C.bdr}`, borderRadius: 6 }}>
                                <span style={{ flex: 1, fontSize: 12 }}>{cl.name}</span>
                                <Btn v="ghost" onClick={() => { if (confirm(`Remove ${s.display_name} from ${cl.name}?`)) callManage("remove_from_class", s.id, { class_id: cid }); }} disabled={busy} style={{ fontSize: 11, padding: "4px 10px", color: C.red, borderColor: "rgba(239,68,68,.3)" }}>Remove</Btn>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* GDPR export */}
                    <div>
                      <Btn v="ghost" onClick={() => exportStudentData(s)} disabled={busy} style={{ width: "100%", fontSize: 11, padding: "8px 10px" }}>Export data (GDPR · JSON)</Btn>
                    </div>

                    {/* Delete */}
                    <div>
                      <Btn v="ghost" onClick={() => { if (confirm(`Permanently delete ${s.display_name}? This removes the account entirely.`)) callManage("delete_student", s.id); }} disabled={busy} style={{ width: "100%", fontSize: 11, padding: "8px 10px", background: C.redS, color: C.red, borderColor: "rgba(239,68,68,.3)" }}>Delete student account</Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {view === "unjoined" && unjoinedStudents.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.mid, fontSize: 12 }}>All students are in a class.</div>}
        </div>
      )}

      {/* SCHOOLS & PLANS — moderator provisioning + fair-use metering */}
      {view === "support" && (
        <div>
          {tickets === null ? <div style={{ padding: 20, color: C.mid, fontSize: 12 }}>Loading…</div>
           : tickets.length === 0 ? <div style={{ padding: 20, textAlign: "center", color: C.mid, fontSize: 12 }}>No support messages yet.</div>
           : tickets.map(t => (
             <Card key={t.id} style={{ padding: 14, marginBottom: 10, borderLeft: `3px solid ${t.status === "open" ? C.amb : C.bdr}` }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                 <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{t.display_name || t.email || "Unknown"} <span style={{ fontWeight: 400, color: C.mid }}>· {t.role || "?"}</span></div>
                 <div style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>{new Date(t.created_at).toLocaleString("en-GB")}</div>
               </div>
               <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{t.message}</div>
               <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 11, color: C.dim }}>
                 {t.email && <a href={`mailto:${t.email}?subject=Re%3A%20your%20Feynman%20Education%20message`} style={{ color: C.pri, fontWeight: 600, textDecoration: "none" }}>Reply by email</a>}
                 {t.page && <span>· {t.page}</span>}
                 <span style={{ flex: 1 }} />
                 {t.status === "open"
                   ? <Btn onClick={() => resolveTicket(t.id, "resolved")} style={{ fontSize: 11, padding: "6px 12px" }}>Mark resolved</Btn>
                   : <Btn v="ghost" onClick={() => resolveTicket(t.id, "open")} style={{ fontSize: 11, padding: "6px 12px" }}>Reopen</Btn>}
               </div>
             </Card>
           ))}
        </div>
      )}

      {view === "schools" && <SchoolsPanel />}

      {/* COSTS — live spend, blend and unit economics from the real ai_usage token log */}
      {view === "costs" && (
        <CostDashboard students={students} classes={classes} teachers={teachers} responses30d={responses30d} />
      )}

      {view === "funnel" && <FunnelDashboard />}

      {/* AI USAGE — real cache hit rate from logged Anthropic usage */}
      {view === "aiusage" && (() => {
        const loadAiUsage = async (days) => {
          setAiUsageLoading(true);
          try {
            const cutoff = new Date(Date.now() - days * 86400000).toISOString();
            const rows = await sb.qAll("ai_usage", { params: {
              select: "ts,call_label,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens",
              ts: `gte.${cutoff}`,
              order: "ts.desc"
            }});
            setAiUsage(rows || []);
          } catch (e) {
            console.error("ai_usage load failed", e);
            setAiUsage([]);
          }
          setAiUsageLoading(false);
        };

        // Auto-load on first render of this view
        if (aiUsage === null && !aiUsageLoading) {
          loadAiUsage(aiUsageWindow);
        }

        const allRows = aiUsage || [];
        // Exclude the zero-token 'shortcut' rows (numerical/exact/cache/flagged) — this
        // tab is specifically about the AI calls; the Costs tab shows the full blend.
        const rows = allRows.filter(r => r.call_label !== "shortcut");
        const totalCalls = rows.length;
        const totalInput = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
        const totalOutput = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
        const totalCacheRead = rows.reduce((s, r) => s + (r.cache_read_tokens || 0), 0);
        const totalCacheWrite = rows.reduce((s, r) => s + (r.cache_creation_tokens || 0), 0);
        // Hit rate = (cache reads) / (cache reads + cache writes). Fresh prompt tokens
        // (input_tokens) are the small per-call user message and don't reflect cache state.
        const cacheableTotal = totalCacheRead + totalCacheWrite;
        const hitRate = cacheableTotal > 0 ? Math.round((totalCacheRead / cacheableTotal) * 100) : 0;
        const callsPerHit = rows.filter(r => (r.cache_read_tokens || 0) > 0).length;
        const callsPerWrite = rows.filter(r => (r.cache_creation_tokens || 0) > 0).length;

        // Haiku 4.5 pricing in USD per million tokens
        const PRICE_INPUT = 1.0;       // fresh prompt tokens
        const PRICE_OUTPUT = 5.0;
        const PRICE_CACHE_READ = 0.10;  // 10% of input
        const PRICE_CACHE_WRITE = 1.25; // 125% of input (one-off write surcharge)
        const usdActual = (totalInput * PRICE_INPUT + totalOutput * PRICE_OUTPUT + totalCacheRead * PRICE_CACHE_READ + totalCacheWrite * PRICE_CACHE_WRITE) / 1_000_000;
        // Hypothetical: what we'd have paid if every cached token had been billed at full input rate
        const usdNoCache = (totalInput * PRICE_INPUT + totalOutput * PRICE_OUTPUT + (totalCacheRead + totalCacheWrite) * PRICE_INPUT) / 1_000_000;
        const usdSaved = Math.max(0, usdNoCache - usdActual);
        const savedPct = usdNoCache > 0 ? Math.round((usdSaved / usdNoCache) * 100) : 0;
        const gbp = (usd) => `£${(usd * 0.79).toFixed(2)}`;

        const firstCalls = rows.filter(r => r.call_label === "first").length;
        const secondCalls = rows.filter(r => r.call_label === "second").length;
        const doubleCheckRate = firstCalls > 0 ? Math.round((secondCalls / firstCalls) * 100) : 0;

        return (
          <div>
            {/* Window selector + refresh */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: C.dim, marginRight: 4 }}>Window:</span>
              {[1, 7, 30].map(d => (
                <button key={d} onClick={() => { setAiUsageWindow(d); loadAiUsage(d); }}
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${aiUsageWindow === d ? C.pri : C.bdr}`, background: aiUsageWindow === d ? C.priSoft : "transparent", color: aiUsageWindow === d ? C.pri : C.mid, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                  {d === 1 ? "24h" : `${d}d`}
                </button>
              ))}
              <button onClick={() => loadAiUsage(aiUsageWindow)} disabled={aiUsageLoading}
                style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: aiUsageLoading ? "wait" : "pointer", fontFamily: "inherit" }}>
                {aiUsageLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {aiUsageLoading && rows.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                No AI calls logged in this window yet. Have a student answer a question to start collecting data.
              </div>
            ) : (
              <>
                {/* Headline tiles */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div style={{ padding: "16px 18px", background: `linear-gradient(135deg, ${C.priSoft}, transparent)`, border: `1px solid ${C.pri}33`, borderRadius: 12 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Cache hit rate</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.pri, lineHeight: 1 }}>{hitRate}%</div>
                    <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>{callsPerHit.toLocaleString()} of {totalCalls.toLocaleString()} AI calls hit cache</div>
                  </div>
                  <div style={{ padding: "16px 18px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Saved by caching</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.txt, lineHeight: 1 }}>{gbp(usdSaved)}</div>
                    <div style={{ fontSize: 11, color: C.mid, marginTop: 4 }}>{savedPct}% off the no-cache cost</div>
                  </div>
                </div>

                {/* Detail row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>AI calls</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{totalCalls.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{firstCalls.toLocaleString()} first, {secondCalls.toLocaleString()} double-check</div>
                  </div>
                  <div style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Actual spend</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{gbp(usdActual)}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>vs. {gbp(usdNoCache)} without cache</div>
                  </div>
                  <div style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Double-check rate</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{doubleCheckRate}%</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>of first-pass calls re-run</div>
                  </div>
                </div>

                {/* Token breakdown */}
                <div style={{ marginTop: 12, padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Token breakdown</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 12 }}>
                    <div style={{ color: C.mid }}>Fresh input (per-call)</div><div style={{ fontFamily: "monospace", textAlign: "right" }}>{totalInput.toLocaleString()}</div>
                    <div style={{ color: C.mid }}>Output</div><div style={{ fontFamily: "monospace", textAlign: "right" }}>{totalOutput.toLocaleString()}</div>
                    <div style={{ color: C.grn || C.pri }}>Cache reads (cheap)</div><div style={{ fontFamily: "monospace", textAlign: "right", color: C.grn || C.pri }}>{totalCacheRead.toLocaleString()}</div>
                    <div style={{ color: C.amb }}>Cache writes (one-off)</div><div style={{ fontFamily: "monospace", textAlign: "right", color: C.amb }}>{totalCacheWrite.toLocaleString()}</div>
                  </div>
                </div>

                <div style={{ marginTop: 16, padding: "10px 12px", background: C.card, border: `1px dashed ${C.bdr}`, borderRadius: 8, fontSize: 11, color: C.mid, lineHeight: 1.6 }}>
                  <strong style={{ color: C.txt }}>How this works.</strong> Every AI call to Haiku writes a row to <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3 }}>ai_usage</code> with token counts from Anthropic’s response. Cache hit rate = cache-read tokens ÷ (cache-read + cache-write tokens). Cache reads cost ~10% of fresh input. Once warm and busy, hit rate should sit at 80–95%. After a quiet period the cache expires (~5 min) and the next call writes a fresh entry.
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* CACHE HEALTH — accepted-answer cache audit */}
      {view === "cache" && (() => {
        const loadCache = async () => {
          setCacheLoading(true);
          try {
            const rows = await sb.q("accepted_answers", { params: {
              select: "id,question_id,normalised_answer,marks_awarded,feedback,confirmation_count,hit_count,last_verified_at,created_at,questions(question_text,topic_id,topics(name))",
              order: "hit_count.desc",
              limit: "200"
            }});
            setCacheRows(rows || []);
          } catch (e) {
            console.error("cache load failed", e);
            setCacheRows([]);
          }
          setCacheLoading(false);
        };

        if (cacheRows === null && !cacheLoading) loadCache();

        const purgeOne = async (id) => {
          if (!confirm("Delete this cached answer? Future students writing this exact phrasing will be re-checked by the AI.")) return;
          setCachePurging(id);
          try {
            await sb.q("accepted_answers", { method: "DELETE", params: { id: `eq.${id}` } });
            setCacheRows(prev => (prev || []).filter(r => r.id !== id));
          } catch (e) { console.error(e); alert("Purge failed: " + e.message); }
          setCachePurging(null);
        };

        const rows = cacheRows || [];
        const total = rows.length;
        const probationary = rows.filter(r => (r.confirmation_count ?? 0) < 3).length;
        const authoritative = total - probationary;
        const totalHits = rows.reduce((s, r) => s + (r.hit_count || 0), 0);
        const suspicious = rows.filter(r => (r.hit_count || 0) > 10 && (r.confirmation_count ?? 0) === 3);

        return (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.dim }}>Showing top {total} cached entries by hit count</span>
              <button onClick={loadCache} disabled={cacheLoading}
                style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: cacheLoading ? "wait" : "pointer", fontFamily: "inherit" }}>
                {cacheLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {cacheLoading && rows.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                No cached answers yet. The cache fills up as students write correct answers that the AI marks with high confidence.
              </div>
            ) : (
              <>
                {/* Stat tiles */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Authoritative</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.pri, marginTop: 4 }}>{authoritative}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>≥3 confirmations</div>
                  </div>
                  <div style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Probationary</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.amb, marginTop: 4 }}>{probationary}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>still verified by AI</div>
                  </div>
                  <div style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: C.mid, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Total cache hits</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.txt, marginTop: 4 }}>{totalHits.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>AI calls saved</div>
                  </div>
                </div>

                {suspicious.length > 0 && (
                  <div style={{ padding: "10px 12px", background: C.amb + "22", border: `1px solid ${C.amb}55`, borderRadius: 8, marginBottom: 12, fontSize: 12, color: C.txt }}>
                    ⚠ {suspicious.length} entr{suspicious.length === 1 ? "y has" : "ies have"} been hit 10+ times with only 3 confirmations — worth spot-checking these manually.
                  </div>
                )}

                {/* Table */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {rows.map(r => {
                    const auth = (r.confirmation_count ?? 0) >= 3;
                    const topicName = r.questions?.topics?.name || "—";
                    return (
                      <div key={r.id} style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>
                              <span style={{ fontFamily: "monospace" }}>{topicName}</span>
                              <span style={{ marginLeft: 8 }}>{r.questions?.question_text?.slice(0, 80) || "(deleted question)"}</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: C.txt, fontFamily: "monospace", wordBreak: "break-word" }}>
                              "{r.normalised_answer}"
                            </div>
                            <div style={{ fontSize: 10, color: C.dim, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                              <span>{r.marks_awarded} mark{r.marks_awarded === 1 ? "" : "s"}</span>
                              <span style={{ color: auth ? C.pri : C.amb }}>{r.confirmation_count} confirmation{r.confirmation_count === 1 ? "" : "s"}</span>
                              <span>{r.hit_count} hit{r.hit_count === 1 ? "" : "s"}</span>
                            </div>
                          </div>
                          <button onClick={() => purgeOne(r.id)} disabled={cachePurging === r.id}
                            style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.red}55`, background: "transparent", color: C.red, cursor: "pointer", fontFamily: "inherit", opacity: cachePurging === r.id ? 0.5 : 1 }}>
                            {cachePurging === r.id ? "…" : "Purge"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 16, padding: "10px 12px", background: C.card, border: `1px dashed ${C.bdr}`, borderRadius: 8, fontSize: 11, color: C.mid, lineHeight: 1.6 }}>
                  <strong style={{ color: C.txt }}>How the cache works.</strong> Once an answer has been independently confirmed by the AI 3 times with high confidence, it becomes authoritative — future students writing the same phrasing skip the AI entirely. Entries expire after 90 days or 50 hits and re-verify. Editing a question's text or model answer wipes its cache. Purge removes a specific entry; the next student typing it will be re-marked by the AI.
                </div>
              </>
            )}
          </div>
        );
      })()}

    </div>
  );
}
