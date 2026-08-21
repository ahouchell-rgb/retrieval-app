"use client";
import { C } from "../lib/theme";
import { SUPA_URL, SUPA_KEY } from "../lib/supabase";
import { sessionId } from "../lib/anonSession";
import { SCHOOL_ANNUAL_PRICE_LABEL } from "../lib/plans";

// Public front door (shown at the root when logged out). Two clear paths:
//   • Log in   — existing students & teachers (accounts are provisioned, not open-signup)
//   • For schools — prospective schools → /pricing (the pilot / quote funnel)
// Returning users with a saved session skip this and land straight in the app.
//
// pupilArrival ({ ref, from }) — set when a pupil clicked a STATIC booklet CTA on
// interactive-science.com. We swap the hero to pupil-facing copy + a direct "create a
// free account" path (not the schools pricing page), and emit funnel telemetry so the
// booklet → signup conversion is measured (the static path was previously untracked).

const BRAND = "Feynman Education";

// Fire-and-forget funnel telemetry, mirroring embed/practice. Best-effort.
function emitFunnel(event, data = {}) {
  if (typeof window === "undefined") return;
  try {
    fetch(`${SUPA_URL}/functions/v1/emit-funnel-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
      body: JSON.stringify({ event, session_id: sessionId(), ...data }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

const FEATURES = [
  { icon: "✍️", title: "Marks written answers", body: "Pupils answer in their own words. The AI marks instantly and fairly — like a teacher would — not just multiple choice." },
  { icon: "🔁", title: "Spaced retrieval, automatically", body: "Every pupil gets the right questions at the right time, so knowledge actually sticks instead of fading." },
  { icon: "📊", title: "Dashboards for staff", body: "Teachers, heads of department and leaders see exactly what each class knows — and you get the marking time back." },
];

export function Landing({ onLogin, pupilArrival }) {
  const btn = (primary) => ({
    display: "inline-block", fontSize: 15, fontWeight: 700, padding: "12px 26px", borderRadius: 10,
    textDecoration: "none", cursor: "pointer", border: primary ? "none" : `1.5px solid ${C.pri}55`,
    background: primary ? C.pri : "transparent", color: primary ? "#fff" : C.pri, fontFamily: "inherit",
  });

  // Pupil "create a free account" — measure the conversion, then open the signup tab.
  // (The booklet_viewed top-of-funnel is recorded on the booklet page itself by
  // add_funnel_analytics.py, so we only record the conversion here.)
  const pupilSignup = () => {
    if (pupilArrival) emitFunnel("signup_clicked", { ref: pupilArrival.ref, from_source: pupilArrival.from });
    onLogin({ signup: true });
  };

  if (pupilArrival) {
    return (
      <div style={{ minHeight: "100dvh", background: C.bg, color: C.txt, fontFamily: "var(--font-plex), -apple-system, sans-serif" }}>
        <div style={{ borderBottom: `1px solid ${C.bdr}`, background: C.card }}>
          <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.txt, letterSpacing: -0.3 }}>Feynman<span style={{ color: C.pri }}> Education</span></span>
            <button onClick={() => onLogin()} style={{ ...btn(false), fontSize: 13, padding: "8px 16px" }}>Log in</button>
          </div>
        </div>
        <div style={{ background: `linear-gradient(165deg, ${C.priSoft}, transparent)` }}>
          <div style={{ maxWidth: 1000, margin: "0 auto", padding: "64px 20px 56px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.pri, letterSpacing: 0.5, marginBottom: 14 }}>FROM YOUR REVISION BOOKLET</div>
            <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.08, margin: "0 auto", maxWidth: 680 }}>Keep it stuck in memory</h1>
            <p style={{ fontSize: 18, color: C.mid, marginTop: 18, maxWidth: 600, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
              You&rsquo;ve revised it — now make it stick. Create a free account to keep practising in your own words, get instant marked feedback, and have each question come back to you spaced just right.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
              <button onClick={pupilSignup} style={btn(true)}>Create a free account</button>
              <button onClick={() => onLogin()} style={btn(false)}>I already have one — log in</button>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 18 }}>Free to start. Got a class code from your teacher? You can join your class after signing in.</div>
          </div>
        </div>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "44px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 14, padding: 22 }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.5 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.bdr}`, padding: "20px 0", textAlign: "center", fontSize: 12, color: C.dim }}>
          {BRAND} · A teacher at your school? <a href="/pricing" style={{ color: C.dim }}>See it for schools →</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.txt, fontFamily: "var(--font-plex), -apple-system, sans-serif" }}>
      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${C.bdr}`, background: C.card }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.txt, letterSpacing: -0.3 }}>Feynman<span style={{ color: C.pri }}> Education</span></span>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <a href="/pricing" style={{ fontSize: 13, fontWeight: 600, color: C.mid, textDecoration: "none" }}>For schools</a>
            <button onClick={onLogin} style={{ ...btn(true), fontSize: 13, padding: "8px 16px" }}>Log in</button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: `linear-gradient(165deg, ${C.priSoft}, transparent)` }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "64px 20px 56px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.pri, letterSpacing: 0.5, marginBottom: 14 }}>AI-MARKED SCIENCE RETRIEVAL PRACTICE</div>
          <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.08, margin: "0 auto", maxWidth: 680 }}>Science revision that marks itself</h1>
          <p style={{ fontSize: 18, color: C.mid, marginTop: 18, maxWidth: 600, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
            Pupils answer in their own words. {BRAND} marks instantly and fairly, then schedules what each one needs to revisit — so knowledge sticks and your department gets the marking time back.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <button onClick={onLogin} style={btn(true)}>Log in</button>
            <a href="/pricing" style={btn(false)}>For schools — {SCHOOL_ANNUAL_PRICE_LABEL}/year &amp; a free pilot</a>
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 18 }}>
            Students — log in, or join your class with a code. Teachers — your school sets up your account.
          </div>
        </div>
      </div>

      {/* Features */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "44px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 14, padding: 22 }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.5 }}>{f.body}</div>
            </div>
          ))}
        </div>

        {/* Schools strip */}
        <div style={{ marginTop: 28, background: `linear-gradient(135deg, ${C.priSoft}, transparent)`, border: `1px solid ${C.pri}33`, borderRadius: 14, padding: "22px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Bringing it to your school?</div>
            <div style={{ fontSize: 13.5, color: C.mid, marginTop: 4 }}>One whole-school plan at {SCHOOL_ANNUAL_PRICE_LABEL} a year. Start with a free pilot—no card required.</div>
          </div>
          <a href="/pricing" style={btn(true)}>See the school plan</a>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.bdr}`, padding: "20px 0", textAlign: "center", fontSize: 12, color: C.dim }}>
        {BRAND} · AI-marked science retrieval practice for UK secondary schools
      </div>
    </div>
  );
}
