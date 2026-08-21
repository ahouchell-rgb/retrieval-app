"use client";
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { PLANS, PLAN_ORDER, markAllowance } from "../lib/plans";

// ─── Admin: Schools & Plans ───
// Moderator provisioning surface. Lists every school with its plan, licence term,
// committed cohort and AI-marks used this term (vs its fair-use allowance) via the
// get_school_plans RPC, and lets a moderator set the plan fields (PATCH schools,
// guarded by the schools_update_moderator policy). This is how a signed PO becomes a
// live licence in the invoice-based model.

const STATUSES = ["trial", "pilot", "active", "lapsed", "cancelled"];
const PLAN_COLORS = { free: "#6B7280", essentials: "#D97706", core: "#2E6FB7", single_cohort: "#7C3AED" };
const STATUS_COLORS = { trial: C.mid, pilot: C.amb, active: C.grn || "#16a34a", lapsed: C.red, cancelled: C.red };

export function SchoolsPanel() {
  const [rows, setRows] = useState(null); // null=loading, false=error, []=data
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // school id
  const [draft, setDraft] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await sb.rpc("get_school_plans");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) { console.error("get_school_plans failed", e); setRows(false); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const startEdit = (s) => {
    setEditing(s.id);
    setDraft({
      plan: s.plan, plan_status: s.plan_status,
      term_start: s.term_start || "", term_end: s.term_end || "",
      committed_pupils: s.committed_pupils ?? "", marks_allowance: s.marks_allowance ?? "",
      billing_notes: s.billing_notes || "",
    });
    setMsg("");
  };

  const save = async (id) => {
    setSavingId(id); setMsg("");
    try {
      const body = {
        plan: draft.plan, plan_status: draft.plan_status,
        term_start: draft.term_start || null, term_end: draft.term_end || null,
        committed_pupils: draft.committed_pupils === "" ? null : Number(draft.committed_pupils),
        marks_allowance: draft.marks_allowance === "" ? null : Number(draft.marks_allowance),
        billing_notes: draft.billing_notes || null,
      };
      await sb.q("schools", { method: "PATCH", params: { id: `eq.${id}` }, body });
      setEditing(null);
      await load();
      setMsg("✓ Saved");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) { setMsg("Error: " + e.message); }
    setSavingId(null);
  };

  const fmtN = (n) => (n == null ? "—" : Number(n).toLocaleString());
  const label = { fontSize: 11, fontWeight: 600, color: C.mid, marginBottom: 3 };
  const input = { fontSize: 13, padding: "7px 9px", border: `1px solid ${C.bdr}`, borderRadius: 6, background: C.card, color: C.txt, fontFamily: "inherit", width: "100%" };

  if (rows === false) {
    return <div style={{ padding: 30, textAlign: "center", color: C.red, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>
      Couldn’t load schools (moderator only). <button onClick={load} style={{ marginLeft: 8, color: C.pri, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Retry</button>
    </div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: C.dim }}>{rows ? `${rows.length} school${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
        {msg && <span style={{ fontSize: 11, color: msg.startsWith("Error") ? C.red : (C.grn || C.pri) }}>{msg}</span>}
        <button onClick={load} disabled={loading} style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, borderRadius: 99, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {rows && rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: C.mid, fontSize: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8 }}>No schools yet.</div>
      )}

      {(rows || []).map((s) => {
        const isEditing = editing === s.id;
        const allowance = markAllowance(isEditing ? { ...s, ...draft } : s);
        const used = s.ai_marks_term || 0;
        const pct = allowance ? Math.min(100, Math.round((used / allowance) * 100)) : null;
        const planColor = PLAN_COLORS[s.plan] || C.mid;
        const overHalf = pct != null && pct >= 80;
        return (
          <div key={s.id} style={{ padding: "12px 14px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 10, marginBottom: 8 }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, flex: 1, minWidth: 120 }}>{s.name || "—"}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: planColor, padding: "2px 8px", borderRadius: 99 }}>{PLANS[s.plan]?.label || s.plan}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLORS[s.plan_status] || C.mid, border: `1px solid ${STATUS_COLORS[s.plan_status] || C.bdr}55`, padding: "2px 8px", borderRadius: 99 }}>{s.plan_status}</span>
              {!isEditing && <button onClick={() => startEdit(s)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.pri, cursor: "pointer", fontFamily: "inherit" }}>Edit plan</button>}
            </div>

            {/* stats */}
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
              <span>{fmtN(s.pupils)} pupils</span>
              <span>{fmtN(s.teachers)} teachers</span>
              {s.committed_pupils != null && <span>{fmtN(s.committed_pupils)} committed</span>}
              {s.term_end && <span>term ends {new Date(s.term_end).toLocaleDateString("en-GB")}</span>}
            </div>

            {/* usage vs allowance */}
            {allowance != null && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: C.mid }}>AI marks this term</span>
                  <span style={{ color: overHalf ? C.amb : C.mid, fontWeight: overHalf ? 700 : 400 }}>{fmtN(used)} / {fmtN(allowance)} ({pct}%)</span>
                </div>
                <div style={{ height: 5, background: C.bdr, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? C.red : overHalf ? C.amb : (C.grn || C.pri), borderRadius: 99 }} />
                </div>
                {overHalf && <div style={{ fontSize: 10, color: C.amb, marginTop: 3 }}>⚠ {pct >= 100 ? "Over allowance — discuss an uplift to the next band." : "Approaching the fair-use allowance."}</div>}
              </div>
            )}

            {s.billing_notes && !isEditing && <div style={{ marginTop: 8, fontSize: 11, color: C.mid, fontStyle: "italic" }}>{s.billing_notes}</div>}

            {/* edit form */}
            {isEditing && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${C.bdr}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={label}>Plan</div>
                  <select value={draft.plan} onChange={e => setDraft(d => ({ ...d, plan: e.target.value }))} style={{ ...input, cursor: "pointer" }}>
                    {PLAN_ORDER.map(k => <option key={k} value={k}>{PLANS[k].label} — {PLANS[k].priceLabel}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Status</div>
                  <select value={draft.plan_status} onChange={e => setDraft(d => ({ ...d, plan_status: e.target.value }))} style={{ ...input, cursor: "pointer" }}>
                    {STATUSES.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Term start</div>
                  <input type="date" value={draft.term_start} onChange={e => setDraft(d => ({ ...d, term_start: e.target.value }))} style={input} />
                </div>
                <div>
                  <div style={label}>Term end</div>
                  <input type="date" value={draft.term_end} onChange={e => setDraft(d => ({ ...d, term_end: e.target.value }))} style={input} />
                </div>
                <div>
                  <div style={label}>Committed pupils</div>
                  <input type="number" min="0" value={draft.committed_pupils} onChange={e => setDraft(d => ({ ...d, committed_pupils: e.target.value }))} placeholder="cohort sold" style={input} />
                </div>
                <div>
                  <div style={label}>Marks allowance {PLANS[draft.plan]?.markCap?.perPupil ? "(blank = pupils × 1,500)" : PLANS[draft.plan]?.markCap?.n ? "(blank = plan default)" : ""}</div>
                  <input type="number" min="0" value={draft.marks_allowance} onChange={e => setDraft(d => ({ ...d, marks_allowance: e.target.value }))} placeholder={markAllowance({ ...s, ...draft, marks_allowance: null }) ?? "auto"} style={input} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={label}>Billing notes</div>
                  <input value={draft.billing_notes} onChange={e => setDraft(d => ({ ...d, billing_notes: e.target.value }))} placeholder="PO number, contact, renewal date…" style={input} />
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6 }}>
                  <button onClick={() => save(s.id)} disabled={savingId === s.id} style={{ flex: 1, fontSize: 12, padding: "9px", borderRadius: 7, border: "none", background: C.pri, color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>{savingId === s.id ? "Saving…" : "Save plan"}</button>
                  <button onClick={() => { setEditing(null); setMsg(""); }} disabled={savingId === s.id} style={{ fontSize: 12, padding: "9px 14px", borderRadius: 7, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 12, padding: "10px 12px", background: C.card, border: `1px dashed ${C.bdr}`, borderRadius: 8, fontSize: 11, color: C.mid, lineHeight: 1.6 }}>
        <strong style={{ color: C.txt }}>How plans work.</strong> New paid schools use the £800/year School plan, which unlocks the full product (including custom question authoring, enforced server-side). Legacy plan keys remain here only for existing records. Fair-use caps are soft: pupils are never blocked; an amber bar at 80%+ is your cue to review usage. AI-marks count from the term start once usage is attributed to the school.
      </div>
    </div>
  );
}
