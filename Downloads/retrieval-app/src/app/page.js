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
  const [welcome, setWelcome] = useState(null);   // arrived from a public interactive-science booklet

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

  if (restoring) return <div style={{ minHeight: "100dvh", background: C.bg }} />;
  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); setShowLogin(true); }} />;
  if (!user) return showLogin
    ? <Auth onAuth={setUser} onBack={() => { setShowLogin(false); setWelcome(null); }} welcome={welcome} />
    : <Landing onLogin={() => setShowLogin(true)} />;
  const teacherSide = isTeacher(user);

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, fontFamily: "var(--font-plex), -apple-system, sans-serif", color: C.txt }}>
      <div style={{ borderBottom: `1px solid ${C.bdr}`, background: C.card, padding: "0 16px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", height: 50 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -.3 }}>Feynman<span style={{ color: C.pri }}> Education</span></span>
            <Badge color={roleColor(user)}>{roleLabel(user)}</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Btn v="ghost" onClick={() => setShowSupport(true)} style={{ padding: "6px 12px", fontSize: 12 }}>Help</Btn>
            <Btn v="ghost" onClick={() => setShowAccount(true)} style={{ padding: "6px 12px", fontSize: 12 }}>Account</Btn>
            <Btn v="ghost" onClick={() => { sb.auth.out(); setUser(null); }} style={{ padding: "6px 12px", fontSize: 12 }}>Log out</Btn>
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
