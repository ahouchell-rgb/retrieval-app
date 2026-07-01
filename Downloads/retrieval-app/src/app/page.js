"use client";
import { useEffect, useState } from "react";
import { Auth, ResetPassword } from "../components/Auth";
import { AccountModal } from "../components/Account";
import { SupportModal } from "../components/SupportModal";
import { Landing } from "../components/Landing";
import { Student } from "../components/Student";
import { Teacher } from "../components/Teacher";
import { Badge, Btn } from "../components/ui";
import { sb } from "../lib/supabase";
import { attachProfile, isTeacher, roleColor, roleLabel } from "../lib/roles";
import { consumeAnonFromUrl } from "../lib/anonSession";
import { C } from "../lib/theme";

export default function App() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  // Logged-out visitors land on the marketing front door; "Log in" reveals the auth
  // form. A ?login deep-link (used by the pricing page's "Log in") skips straight to it.
  const [showLogin, setShowLogin] = useState(false);
  const [recovery, setRecovery] = useState(false);   // arrived via a password-reset email link
  const [showAccount, setShowAccount] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [welcome, setWelcome] = useState(null);   // arrived from a public interactive-science booklet (widget handoff)
  const [authSignup, setAuthSignup] = useState(false); // open auth on the signup tab (pupil arriving from a booklet)
  const [pupilArrival, setPupilArrival] = useState(null); // { ref, from } — clicked a static booklet CTA

  // Re-establish a persisted session on load so a refresh doesn't bounce to login.
  useEffect(() => {
    let alive = true;
    (async () => {
      // A password-reset email link lands here with recovery tokens in the URL hash.
      if (sb.auth.applyRecovery()) { if (alive) { setRecovery(true); setRestoring(false); } return; }
      try {
        const u = await sb.auth.restore();
        if (u && alive) setUser(await attachProfile(u));
      } catch { /* no valid session — fall through to the landing page */ }
      if (alive) setRestoring(false);
    })();
    return () => { alive = false; };
  }, []);

  // Deep-link to the login form (e.g. from /pricing) without a hydration mismatch.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("login")) setShowLogin(true);
  }, []);

  // Arrival from a public interactive-science booklet (?isci=1&att=…&cor=…): show
  // the signup form with a continuity banner, then strip the params so a refresh
  // doesn't re-trigger it. The handoff carries counts only — see lib/anonSession.
  useEffect(() => {
    const w = consumeAnonFromUrl();
    if (!w) return;
    setWelcome(w);
    setShowLogin(true);
    try {
      const url = new URL(window.location.href);
      ["isci", "att", "cor", "from", "topic"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    } catch { /* ignore */ }
  }, []);

  // A pupil who clicked a STATIC booklet CTA arrives with ?ref=interactive-science&from=<slug>
  // (no ?isci handoff — that's the widget path above). Show the Landing in pupil mode so they
  // get the right message + a direct signup, instead of the schools marketing copy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("isci") === "1") return; // widget handoff is handled above
    const ref = p.get("ref");
    if (ref) setPupilArrival({ ref, from: p.get("from") || null });
  }, []);

  if (restoring) return <div style={{ minHeight: "100dvh", background: C.bg }} />;
  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); setShowLogin(true); }} />;
  if (!user) return showLogin
    ? <Auth onAuth={setUser} onBack={() => { setShowLogin(false); setWelcome(null); setAuthSignup(false); }} welcome={welcome} startMode={authSignup ? "signup" : undefined} />
    : <Landing pupilArrival={pupilArrival} onLogin={(opts) => { if (opts?.signup) setAuthSignup(true); setShowLogin(true); }} />;
  const teacherSide = isTeacher(user);

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, fontFamily: "var(--font-plex), -apple-system, sans-serif", color: C.txt }}>
      <div style={{ borderBottom: `1px solid ${C.bdr}`, background: C.panel, color: "#fff", padding: "0 18px", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(20,23,26,0.08)" }}>
        <div style={{ maxWidth: teacherSide ? 1180 : 700, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 58, gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "#fff", color: C.pri, display: "grid", placeItems: "center", fontFamily: C.serif, fontSize: 19, fontWeight: 800, flexShrink: 0 }}>F</span>
            <span style={{ fontSize: 16, fontWeight: 800, whiteSpace: "nowrap" }}>Feynman<span style={{ color: "#f7b1aa" }}> Education</span></span>
            <Badge color={roleColor(user)}>{roleLabel(user)}</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Btn v="ghost" onClick={() => setShowSupport(true)} style={{ padding: "7px 12px", minHeight: 34, fontSize: 12, background: "rgba(255,255,255,0.08)", color: "#dbe6ef", border: "1px solid rgba(255,255,255,0.16)" }}>Help</Btn>
            <Btn v="ghost" onClick={() => setShowAccount(true)} style={{ padding: "7px 12px", minHeight: 34, fontSize: 12, background: "rgba(255,255,255,0.08)", color: "#dbe6ef", border: "1px solid rgba(255,255,255,0.16)" }}>Account</Btn>
            <Btn v="ghost" onClick={() => { sb.auth.out(); setUser(null); }} style={{ padding: "7px 12px", minHeight: 34, fontSize: 12, background: "transparent", color: "#93a1b2", border: "1px solid rgba(255,255,255,0.12)" }}>Log out</Btn>
          </div>
        </div>
      </div>
      {showAccount && <AccountModal user={user} onClose={() => setShowAccount(false)}
        onUpdated={(name) => setUser(u => ({ ...u, user_metadata: { ...u.user_metadata, display_name: name }, profile: { ...u.profile, display_name: name } }))} />}
      {showSupport && <SupportModal user={user} onClose={() => setShowSupport(false)} />}
      <div style={{ paddingBottom: 60 }}>{teacherSide ? <Teacher user={user} /> : <Student user={user} />}</div>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${C.bg};-webkit-font-smoothing:antialiased}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes starPop{0%{opacity:0;transform:scale(0) rotate(-30deg)}20%{opacity:1;transform:scale(1.5) rotate(10deg)}40%{transform:scale(1.2) rotate(-5deg)}60%{transform:scale(1.3) rotate(3deg)}100%{opacity:0;transform:scale(2) translateY(-40px) rotate(15deg)}}
        @keyframes pulseToday{0%,100%{box-shadow:0 0 0 0 ${C.priGlow}}50%{box-shadow:0 0 0 6px transparent}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes milestonePop{0%{opacity:0;transform:scale(0.5)}60%{opacity:1;transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
        button:active{transform:scale(.98)}
        input:focus,textarea:focus,select:focus{border-color:${C.pri}!important;box-shadow:0 0 0 3px ${C.priGlow}}
        button:focus{outline:none}
        button:focus-visible{outline:2px solid ${C.pri};outline-offset:2px}
        ::selection{background:${C.priGlow}}
        select option{background:${C.card};color:${C.txt}}
      `}</style>
    </div>
  );
}
