"use client";
import { useState } from "react";
import { SUPA_KEY, SUPA_URL, sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { activityCountForPeriod, matchesActivityFilter } from "../lib/week";
import { Btn, Inp } from "./ui";

export function StudentList({ students, cls, clsTarget, selectedWeek = 0, activityWindowWeeks = 0, activityFilter = "all", onRefresh, parentTokens = {}, onGenerateToken, onRevokeToken }) {
  const [expanded, setExpanded] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [renaming, setRenaming] = useState(null); // studentId being renamed
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [targetEdits, setTargetEdits] = useState({}); // studentId -> draft value
  // First-party parent report link (replaces the old external parent-hub).
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const parentUrl = (id) => `${origin}/parent/${parentTokens[id]}`;

  const callManage = async (action, studentId, extra = {}) => {
    setBusy(true); setMsg("");
    try {
      const jwt = sb.auth.getToken();
      const r = await fetch(`${SUPA_URL}/functions/v1/manage-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${jwt || SUPA_KEY}` },
        body: JSON.stringify({ action, student_id: studentId, class_id: cls.id, ...extra }),
      });
      const d = await r.json();
      if (d.success) {
        setMsg(d.message);
        if (action === "delete_student" || action === "remove_from_class") {
          setTimeout(() => { onRefresh(); setExpanded(null); setMsg(""); }, 1000);
        }
      } else {
        setMsg("Error: " + (d.error || "Unknown error"));
      }
    } catch (e) { setMsg("Error: " + e.message); }
    setBusy(false);
  };

  const saveTargetOverride = async (studentId, value) => {
    setBusy(true);
    try {
      const override = value === "" || value === null || value === undefined ? null : Number(value);
      await sb.q("class_members", {
        method: "PATCH",
        params: { student_id: `eq.${studentId}`, class_id: `eq.${cls.id}` },
        body: { weekly_target_override: override },
      });
      setTargetEdits(p => { const n = { ...p }; delete n[studentId]; return n; });
      setTimeout(() => onRefresh(), 300);
    } catch (e) { setMsg("Error: " + e.message); }
    setBusy(false);
  };

  // A zero-week window means the exact week selected in the overview. Positive
  // windows are rolling periods from the current week (last 2/3/4/etc weeks).
  const periodValidOf = (student) => activityCountForPeriod(student, { selectedWeek, windowWeeks: activityWindowWeeks });
  const visibleStudents = students
    .filter(student => matchesActivityFilter(periodValidOf(student), activityFilter))
    .sort((a, b) => periodValidOf(b) - periodValidOf(a) || a.name.localeCompare(b.name));

  return (
    <div>
      {visibleStudents.length === 0 ? (
        <div style={{ padding: "18px 12px", borderRadius: 8, background: C.card2, color: C.dim, fontSize: 13, textAlign: "center" }}>
          {activityFilter === "active" ? "No pupils recorded activity in this period." : activityFilter === "inactive" ? "Every pupil recorded some activity in this period." : "No pupils are enrolled in this class yet."}
        </div>
      ) : visibleStudents.map(s => {
        const effectiveTarget = s.targetOverride ?? clsTarget;
        const p = s.t > 0 ? Math.round(s.c / s.t * 100) : 0;
        const periodValid = periodValidOf(s);
        const periodTarget = effectiveTarget * (activityWindowWeeks || 1);
        const hasTarget = true;
        const weekPct = hasTarget && periodTarget > 0 ? Math.min(100, Math.round((periodValid / periodTarget) * 100)) : 0;
        const metTarget = hasTarget && periodValid >= periodTarget;
        const isExpanded = expanded === s.id;

        return (
          <div key={s.id} style={{ marginBottom: 4 }}>
            <button onClick={() => { setExpanded(isExpanded ? null : s.id); setNewPw(""); setMsg(""); setConfirmDelete(null); setRenaming(null); setRenameDraft(""); }} style={{
              width: "100%", padding: "10px 10px", borderRadius: isExpanded ? "8px 8px 0 0" : 8, background: C.card2, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              borderLeft: `3px solid ${!hasTarget ? C.bdr : metTarget ? C.grn : periodValid < periodTarget * 0.5 ? C.red : C.amb}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, color: C.txt, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{s.name}</div>
                {s.targetOverride && <span style={{ fontSize: 9, color: C.acc, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>custom target</span>}
                {s.flagged > 0 && <span style={{ fontSize: 10, color: C.red, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}><svg width="9" height="9" viewBox="0 0 24 24" fill={C.red} stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" stroke={C.red} fill="none" /></svg>{s.flagged}</span>}
                <span style={{ fontSize: 11, fontWeight: 700, color: !hasTarget ? C.txt : metTarget ? C.grn : C.red }}>{hasTarget ? `${periodValid}/${periodTarget}` : periodValid}</span>
                <span style={{ color: C.dim, fontSize: 12, transition: "transform .2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {hasTarget ? (
                  <div style={{ flex: 1, height: 5, background: C.bdr, borderRadius: 99 }}>
                    <div style={{ width: `${weekPct}%`, height: "100%", background: metTarget ? C.grn : weekPct >= 50 ? C.amb : C.red, borderRadius: 99, transition: "width .3s" }} />
                  </div>
                ) : <div style={{ flex: 1 }} />}
                <span style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>{p}% acc · 12 weeks</span>
              </div>
            </button>

            {/* Expanded panel */}
            {isExpanded && (
              <div style={{ padding: 12, background: C.card, borderRadius: "0 0 8px 8px", borderLeft: `3px solid ${C.bdr}`, borderBottom: `1px solid ${C.bdr}`, borderRight: `1px solid ${C.bdr}` }}>
                {msg && <div style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 10, fontSize: 12, background: msg.startsWith("Error") ? C.redS : C.grnS, color: msg.startsWith("Error") ? C.red : C.grn }}>{msg}</div>}

                {/* Twelve-week stats */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: C.card2, textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.acc }}>{s.t}</div>
                    <div style={{ fontSize: 10, color: C.dim }}>12 weeks</div>
                  </div>
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: C.card2, textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.grn }}>{s.c}</div>
                    <div style={{ fontSize: 10, color: C.dim }}>Correct</div>
                  </div>
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: C.card2, textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: p >= 70 ? C.grn : p >= 50 ? C.amb : C.red }}>{p}%</div>
                    <div style={{ fontSize: 10, color: C.dim }}>Accuracy</div>
                  </div>
                </div>

                {/* 12-week history bars */}
                {s.weeklyHistory && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 8 }}>Weekly homework history (12 weeks)</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
                      {[...s.weeklyHistory].reverse().map((w, i) => {
                        const barH = effectiveTarget > 0 ? Math.min(100, (w.valid / effectiveTarget) * 100) : 0;
                        const met = w.valid >= effectiveTarget;
                        const isCurrent = w.weeksAgo === 0;
                        return (
                          <div key={i} title={`${w.label}: ${w.valid} questions`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <div style={{ fontSize: 8, color: met ? C.grn : w.valid > 0 ? C.amb : C.dim, fontWeight: 600, lineHeight: 1 }}>
                              {w.valid > 0 ? w.valid : ""}
                            </div>
                            <div style={{ width: "100%", height: 52, background: C.bdr, borderRadius: 3, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden", outline: isCurrent ? `1px solid ${C.pri}` : "none" }}>
                              <div style={{ width: "100%", height: `${Math.max(barH, w.valid > 0 ? 5 : 0)}%`, background: met ? C.grn : w.valid >= effectiveTarget * 0.5 ? C.amb : w.valid > 0 ? C.red : "transparent", borderRadius: 3, transition: "height .3s" }} />
                            </div>
                            <div style={{ fontSize: 7, color: isCurrent ? C.txt : C.dim, fontWeight: isCurrent ? 700 : 400, lineHeight: 1, textAlign: "center" }}>
                              {isCurrent ? "now" : `${w.weeksAgo}w`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Per-student target override */}
                <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: C.card2 }}>
                  <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>
                    Individual target <span style={{ color: C.dim, fontWeight: 400 }}>(blank = use class default of {clsTarget})</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" min={1} max={200}
                      value={targetEdits[s.id] !== undefined ? targetEdits[s.id] : (s.targetOverride ?? "")}
                      placeholder={`${clsTarget} (class default)`}
                      onChange={e => setTargetEdits(p => ({ ...p, [s.id]: e.target.value }))}
                      style={{ flex: 1, padding: "7px 10px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: "inherit", outline: "none" }}
                    />
                    <Btn onClick={() => saveTargetOverride(s.id, targetEdits[s.id] !== undefined ? targetEdits[s.id] : (s.targetOverride ?? ""))}
                      disabled={busy || targetEdits[s.id] === undefined}
                      style={{ whiteSpace: "nowrap", fontSize: 12, padding: "8px 14px" }}>
                      {busy ? "..." : "Save"}
                    </Btn>
                    {s.targetOverride && (
                      <Btn v="ghost" onClick={() => saveTargetOverride(s.id, "")} disabled={busy} style={{ fontSize: 12, padding: "8px 10px" }}>
                        Reset
                      </Btn>
                    )}
                  </div>
                </div>

                {/* Parent access */}
                <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: C.card2 }}>
                  <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 8 }}>Parent access link</div>
                  {parentTokens[s.id] ? (
                    <div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input readOnly value={parentUrl(s.id)}
                          style={{ flex: 1, padding: "6px 8px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 6, color: C.dim, fontSize: 11, fontFamily: "monospace", outline: "none" }} />
                        <button onClick={() => { navigator.clipboard.writeText(parentUrl(s.id)); setMsg("Link copied!"); setTimeout(() => setMsg(""), 2000); }}
                          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.pri, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                          Copy
                        </button>
                      </div>
                      <button onClick={() => onRevokeToken(s.id)} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                        Revoke link
                      </button>
                    </div>
                  ) : (
                    <Btn onClick={async () => { const t = await onGenerateToken(s.id); if (t) setMsg("Link generated — copy it above"); }} disabled={busy} style={{ fontSize: 12, padding: "8px 14px" }}>
                      Generate parent link
                    </Btn>
                  )}
                </div>

                {/* Identity — email + rename */}
                <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: C.card2 }}>
                  <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 8 }}>Identity</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: C.dim, minWidth: 44, textTransform: "uppercase", letterSpacing: 0.5 }}>Email</span>
                    <input readOnly value={s.email || "—"}
                      style={{ flex: 1, padding: "6px 8px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 6, color: C.dim, fontSize: 11, fontFamily: "monospace", outline: "none" }} />
                    <button onClick={() => { if (s.email) { navigator.clipboard.writeText(s.email); setMsg("Email copied"); setTimeout(() => setMsg(""), 1500); } }}
                      disabled={!s.email}
                      style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.pri, color: "#fff", fontSize: 11, cursor: s.email ? "pointer" : "default", fontFamily: "inherit", fontWeight: 600, opacity: s.email ? 1 : 0.4 }}>
                      Copy
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: C.dim, minWidth: 44, textTransform: "uppercase", letterSpacing: 0.5 }}>Name</span>
                    {renaming === s.id ? (
                      <>
                        <Inp value={renameDraft} onChange={e => setRenameDraft(e.target.value)} autoFocus maxLength={80}
                          onKeyDown={e => { if (e.key === "Escape") { setRenaming(null); setRenameDraft(""); } }}
                          style={{ fontSize: 13, padding: "6px 8px" }} />
                        <Btn onClick={async () => {
                            const t = renameDraft.trim();
                            if (!t || t === s.name) { setRenaming(null); setRenameDraft(""); return; }
                            await callManage("rename_student", s.id, { new_name: t });
                            setRenaming(null); setRenameDraft(""); onRefresh();
                          }} disabled={busy || !renameDraft.trim() || renameDraft.trim() === s.name}
                          style={{ whiteSpace: "nowrap", fontSize: 12, padding: "7px 12px" }}>
                          {busy ? "..." : "Save"}
                        </Btn>
                        <Btn v="ghost" onClick={() => { setRenaming(null); setRenameDraft(""); }}
                          style={{ fontSize: 12, padding: "7px 10px" }}>
                          Cancel
                        </Btn>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, fontSize: 13, color: C.txt, fontWeight: 500 }}>{s.name}</span>
                        <Btn v="ghost" onClick={() => { setRenaming(s.id); setRenameDraft(s.name); }}
                          style={{ fontSize: 12, padding: "6px 12px" }}>
                          Rename
                        </Btn>
                      </>
                    )}
                  </div>
                </div>

                {/* Reset password */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Reset password</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Inp placeholder="New password (min 6)" type="text" value={newPw} onChange={e => setNewPw(e.target.value)} style={{ fontSize: 13, padding: "8px 10px" }} />
                    <Btn onClick={() => callManage("reset_password", s.id, { new_password: newPw })} disabled={newPw.length < 6 || busy} style={{ whiteSpace: "nowrap", fontSize: 12, padding: "8px 14px" }}>
                      {busy ? "..." : "Reset"}
                    </Btn>
                  </div>
                </div>

                {/* Remove + Delete */}
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn v="ghost" onClick={() => callManage("remove_from_class", s.id)} disabled={busy} style={{ flex: 1, fontSize: 11, padding: "8px 10px" }}>
                    Remove from class
                  </Btn>
                  {confirmDelete === s.id ? (
                    <Btn v="ghost" onClick={() => callManage("delete_student", s.id)} disabled={busy} style={{ flex: 1, fontSize: 11, padding: "8px 10px", background: C.redS, color: C.red, borderColor: "rgba(239,68,68,.3)" }}>
                      {busy ? "..." : "Confirm delete"}
                    </Btn>
                  ) : (
                    <Btn v="ghost" onClick={() => setConfirmDelete(s.id)} style={{ flex: 1, fontSize: 11, padding: "8px 10px", color: C.red, borderColor: "rgba(239,68,68,.2)" }}>
                      Delete account
                    </Btn>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Bulk Upload Students ─── */
