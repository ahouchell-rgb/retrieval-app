"use client";
import { useState } from "react";
import { SCHOOL_ANNUAL_PRICE_LABEL } from "../../lib/plans";
import { SUPA_KEY, SUPA_URL } from "../../lib/supabase";
import { Icon } from "../../components/Icon";
import { PublicFooter, PublicHeader } from "../../components/PublicChrome";

const SCHOOL_FEATURES = [
  "Unlimited pupils, teachers and classes",
  "Written-answer marking and spaced retrieval",
  "Curriculum-mapped bank plus your own questions",
  "Teacher, department and leadership views",
  "Targeted assignments, papers and intervention tracking",
  "School onboarding and email support",
];

const FAQS = [
  ["Is the price really fixed?", `Yes. The annual licence is ${SCHOOL_ANNUAL_PRICE_LABEL} per school, excluding VAT, rather than a per-pupil or feature-tier calculation.`],
  ["What happens during the free pilot?", "We agree a suitable class or year group, help you set it up and use real pupil practice to decide whether the full-school licence is worthwhile. No payment card is required."],
  ["Can teachers review AI marks?", "Yes. Pupils can flag a mark, and teachers can review, uphold or overturn it. The marking-quality view makes this oversight visible."],
  ["What information can our data protection lead review?", "The trust centre explains the current application data flow, AI provider, access controls and retention approach. Contact us for school-specific procurement or data-processing questions."],
];

const EMPTY_FORM = { school_name: "", contact_name: "", email: "", role: "", pupils: "", plan_interest: "pilot", message: "" };

export default function Pricing() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [state, setState] = useState("idle");
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.email.trim() || !form.school_name.trim()) { setState("error"); return; }
    setState("sending");
    try {
      const response = await fetch(`${SUPA_URL}/rest/v1/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "return=minimal" },
        body: JSON.stringify({ ...form, pupils: form.pupils === "" ? null : Number(form.pupils), source: "pricing_page" }),
      });
      if (!response.ok) throw new Error("lead insert failed");
      setState("done");
    } catch { setState("error"); }
  };

  return (
    <div className="public-shell">
      <PublicHeader />
      <main id="main-content">
        <section className="pricing-hero">
          <div className="public-wrap">
            <div className="section-eyebrow">Straightforward school pricing</div>
            <h1>One school. Every science class. {SCHOOL_ANNUAL_PRICE_LABEL} a year.</h1>
            <p>No pupil bands, hidden feature tiers or upgrade calculations. Start with one real class in a free pilot, then decide whether to open Feynman to the whole school.</p>
          </div>
        </section>

        <div className="public-wrap pricing-layout">
          <aside className="price-card">
            <div className="price-card-head"><div className="price-card-label">Whole-school annual licence</div><div className="price-amount"><strong>{SCHOOL_ANNUAL_PRICE_LABEL}</strong><span>per school / year</span></div></div>
            <div className="price-card-body">
              {SCHOOL_FEATURES.map((feature) => <div className="price-feature" key={feature}><Icon name="check" size={17}/><span>{feature}</span></div>)}
              <div className="price-note">Invoiced annually. VAT is excluded. The free pilot begins before any paid licence and does not require a card.</div>
              <a className="public-button large" href="#contact">Start a free pilot <Icon name="arrow" size={16}/></a>
            </div>
          </aside>

          <section className="pilot-panel" id="contact">
            {state === "done" ? (
              <div role="status" style={{ textAlign: "center", padding: "48px 10px" }}>
                <span className="feature-icon" style={{ margin: "0 auto", background: "#e8f5ef", color: "#16835e" }}><Icon name="check" size={20}/></span>
                <h2 style={{ marginTop: 19 }}>Your enquiry is with us.</h2>
                <p>We’ll email {form.email} to arrange the next step. There is nothing to pay now.</p>
              </div>
            ) : (
              <>
                <h2>Try it with a real class first.</h2>
                <p>Tell us who you are and what you would like to test. We will help you choose a sensible pilot rather than asking you to configure the whole school on day one.</p>
                <div className="pilot-steps"><div className="pilot-step"><b>1 · Agree the cohort</b><span>One class or year group is enough.</span></div><div className="pilot-step"><b>2 · Set up together</b><span>Classes, content and staff access.</span></div><div className="pilot-step"><b>3 · Review the evidence</b><span>Decide whether the licence earns its place.</span></div></div>
                <form onSubmit={submit}>
                  <div className="form-grid">
                    <div className="form-field"><label htmlFor="school-name">School name *</label><input className="form-control" id="school-name" value={form.school_name} onChange={set("school_name")} autoComplete="organization" required /></div>
                    <div className="form-field"><label htmlFor="contact-name">Your name</label><input className="form-control" id="contact-name" value={form.contact_name} onChange={set("contact_name")} autoComplete="name" /></div>
                    <div className="form-field"><label htmlFor="email">Work email *</label><input className="form-control" id="email" type="email" value={form.email} onChange={set("email")} autoComplete="email" required /></div>
                    <div className="form-field"><label htmlFor="role">Your role</label><input className="form-control" id="role" value={form.role} onChange={set("role")} placeholder="e.g. Head of Science" /></div>
                    <div className="form-field"><label htmlFor="pupils">Approximate science pupils</label><input className="form-control" id="pupils" type="number" min="0" value={form.pupils} onChange={set("pupils")} /></div>
                    <div className="form-field"><label htmlFor="interest">What would you like to do?</label><select className="form-control" id="interest" value={form.plan_interest} onChange={set("plan_interest")}><option value="pilot">Start with a free pilot</option><option value="core">Discuss the {SCHOOL_ANNUAL_PRICE_LABEL} plan</option></select></div>
                    <div className="form-field full"><label htmlFor="message">Anything we should know?</label><textarea className="form-control" id="message" value={form.message} onChange={set("message")} /></div>
                  </div>
                  {state === "error" ? <div className="form-error" role="alert">We could not send that yet. Check the school name and email, then try again.</div> : null}
                  <div className="form-submit"><button className="public-button large" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send pilot enquiry"} <Icon name="arrow" size={16}/></button></div>
                </form>
              </>
            )}
          </section>
        </div>

        <section className="pricing-faq"><div className="public-wrap faq-grid"><div><div className="section-eyebrow">Questions schools ask</div><h2 className="section-heading">The detail, without the sales fog.</h2><p className="section-intro">For anything specific to your trust or school, email <a href="mailto:schools@feynmaneducation.com">schools@feynmaneducation.com</a>.</p></div><div className="faq-list">{FAQS.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div></section>
      </main>
      <PublicFooter />
    </div>
  );
}
