"use client";
import { useState } from "react";
import { SUPA_URL, SUPA_KEY } from "../../lib/supabase";
import { C } from "../../lib/theme";
import { SCHOOL_ANNUAL_PRICE_LABEL } from "../../lib/plans";

// Public pricing / marketing page (no auth). One annual school licence, with
// pilot / licence enquiries inserted into `leads` (anon insert allowed by RLS).

const BRAND = "Feynman Education";

const SCHOOL_FEATURES = [
  "Unlimited pupils, teachers and classes",
  "AI marking of written answers and automatic spaced retrieval",
  "Full curriculum-mapped question bank plus your own questions",
  "Teacher, head-of-department, leadership and MIS views",
  "Termly updates, email support and full GDPR cover",
];

export default function Pricing() {
  const [form, setForm] = useState({ school_name: "", contact_name: "", email: "", role: "", pupils: "", plan_interest: "pilot", message: "" });
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.school_name.trim()) { setState("error"); return; }
    setState("sending");
    try {
      // Direct anon insert with return=minimal: visitors can submit a lead but not
      // read the leads table (only moderators can), so we must NOT ask PostgREST to
      // return the inserted row — that would trip the SELECT policy.
      const r = await fetch(`${SUPA_URL}/rest/v1/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "return=minimal" },
        body: JSON.stringify({ ...form, pupils: form.pupils === "" ? null : Number(form.pupils), source: "pricing_page" }),
      });
      if (!r.ok) throw new Error("lead insert failed");
      setState("done");
    } catch { setState("error"); }
  };

  const wrap = { maxWidth: 1000, margin: "0 auto", padding: "0 20px" };
  const card = { background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 14 };
  const input = { width: "100%", fontSize: 14, padding: "10px 12px", border: `1px solid ${C.bdr}`, borderRadius: 8, background: C.bg, color: C.txt, fontFamily: "inherit" };
  const label = { fontSize: 12, fontWeight: 600, color: C.mid, marginBottom: 4, display: "block" };

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.txt, fontFamily: "var(--font-plex), -apple-system, sans-serif" }}>
      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${C.bdr}`, background: C.card }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ fontSize: 16, fontWeight: 800, color: C.txt, letterSpacing: -0.3, textDecoration: "none" }}>Feynman<span style={{ color: C.pri }}> Education</span></a>
          <a href="/?login=1" style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: C.pri, padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>Log in</a>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg, ${C.priSoft}, transparent)`, borderBottom: `1px solid ${C.bdr}`, padding: "56px 0 48px" }}>
        <div style={wrap}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.pri, letterSpacing: 0.5, marginBottom: 10 }}>{BRAND.toUpperCase()}</div>
          <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, margin: 0, maxWidth: 620 }}>One school. One plan. {SCHOOL_ANNUAL_PRICE_LABEL} a year.</h1>
          <p style={{ fontSize: 17, color: C.mid, marginTop: 14, maxWidth: 600, lineHeight: 1.5 }}>
            Give your whole school AI-marked science retrieval practice, instant pupil feedback and clear staff dashboards—without per-pupil bands or surprise upgrades.
          </p>
        </div>
      </div>

      {/* Single annual school plan */}
      <div style={{ ...wrap, marginTop: 36 }}>
        <div style={{ ...card, maxWidth: 700, margin: "0 auto", padding: 28, border: `2px solid ${C.pri}`, boxShadow: `0 8px 30px ${C.priGlow || "rgba(0,0,0,.06)"}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.pri, textTransform: "uppercase", letterSpacing: 0.6 }}>Whole-school annual licence</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>{SCHOOL_ANNUAL_PRICE_LABEL}</span>
            <span style={{ fontSize: 14, color: C.dim }}>per school / year</span>
          </div>
          <div style={{ fontSize: 13, color: C.mid, marginTop: 4, marginBottom: 18 }}>One price for the full product, regardless of school size. Invoiced annually. VAT excluded.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10, marginBottom: 22 }}>
            {SCHOOL_FEATURES.map((feature) => (
              <div key={feature} style={{ display: "flex", gap: 8, fontSize: 13, color: C.mid, lineHeight: 1.4 }}>
                <span style={{ color: C.grn || C.pri, flexShrink: 0 }}>✓</span><span>{feature}</span>
              </div>
            ))}
          </div>
          <a href="#contact" style={{ display: "block", textAlign: "center", fontSize: 14, fontWeight: 700, padding: "11px", borderRadius: 8, textDecoration: "none", background: C.pri, color: "#fff" }}>Start a free pilot</a>
        </div>

        {/* Simple terms */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Try it with your pupils first</div>
            <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.5 }}>Run a free pilot with one class or year group. No card is required, and the paid licence starts only when your school is ready.</div>
          </div>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>No pricing calculations</div>
            <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.5 }}>No pupil bands, feature tiers or minimum cohort. The annual price is {SCHOOL_ANNUAL_PRICE_LABEL} for each school.</div>
          </div>
        </div>

        {/* Contact / lead form */}
        <div id="contact" style={{ ...card, padding: 24, marginTop: 24, marginBottom: 48 }}>
          {state === "done" ? (
            <div style={{ textAlign: "center", padding: "30px 10px" }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Thanks — we’ll be in touch shortly.</div>
              <div style={{ fontSize: 13, color: C.mid, marginTop: 6 }}>We’ll email {form.email} to set up your pilot or annual school licence.</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>Start a free pilot or choose the {SCHOOL_ANNUAL_PRICE_LABEL} school plan</div>
              <div style={{ fontSize: 13, color: C.mid, marginTop: 6 }}>Tell us about your school and we’ll get you set up. No card is required.</div>
              <div style={{ fontSize: 13, color: C.mid, marginTop: 4, marginBottom: 18 }}>Prefer email? Write to <a href="mailto:schools@feynmaneducation.com" style={{ color: C.pri, fontWeight: 600, textDecoration: "none" }}>schools@feynmaneducation.com</a>.</div>
              <form onSubmit={submit}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><label style={label}>School name *</label><input style={input} value={form.school_name} onChange={set("school_name")} required /></div>
                  <div><label style={label}>Your name</label><input style={input} value={form.contact_name} onChange={set("contact_name")} /></div>
                  <div><label style={label}>Email *</label><input style={input} type="email" value={form.email} onChange={set("email")} required /></div>
                  <div><label style={label}>Your role</label><input style={input} value={form.role} onChange={set("role")} placeholder="e.g. Head of Science" /></div>
                  <div><label style={label}>Science pupils (approx.)</label><input style={input} type="number" min="0" value={form.pupils} onChange={set("pupils")} /></div>
                  <div><label style={label}>What would you like to do?</label>
                    <select style={{ ...input, cursor: "pointer" }} value={form.plan_interest} onChange={set("plan_interest")}>
                      <option value="pilot">Start with a free pilot</option>
                      <option value="core">School plan — {SCHOOL_ANNUAL_PRICE_LABEL}/year</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}><label style={label}>Anything else?</label><textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={form.message} onChange={set("message")} /></div>
                {state === "error" && <div style={{ fontSize: 13, color: C.red, marginBottom: 10 }}>Please add at least a school name and a valid email, then try again.</div>}
                <button type="submit" disabled={state === "sending"} style={{ fontSize: 15, fontWeight: 700, padding: "12px 28px", borderRadius: 9, border: "none", background: C.pri, color: "#fff", cursor: state === "sending" ? "wait" : "pointer", fontFamily: "inherit" }}>{state === "sending" ? "Sending…" : "Send my enquiry"}</button>
              </form>
            </>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.bdr}`, padding: "20px 0", textAlign: "center", fontSize: 12, color: C.dim }}>
        {BRAND} · <a href="mailto:schools@feynmaneducation.com" style={{ color: C.dim }}>schools@feynmaneducation.com</a> · feynmaneducation.com<br />
        {SCHOOL_ANNUAL_PRICE_LABEL} per school per year · VAT excluded.
      </div>
    </div>
  );
}
