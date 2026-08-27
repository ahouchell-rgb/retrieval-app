"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Auth, ResetPassword } from "./Auth";
import { AccountModal } from "./Account";
import { SupportModal } from "./SupportModal";
import { Landing } from "./Landing";
import { Badge, Btn, LoadingState } from "./ui";
import { sb } from "../lib/supabase";
import { attachProfile, isTeacher, roleColor, roleLabel } from "../lib/roles";
import { consumeAnonFromUrl } from "../lib/anonSession";
import { C } from "../lib/theme";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { ConnectivityBanner } from "./ConnectivityBanner";

const Teacher = dynamic(() => import("./Teacher").then(module => module.Teacher), {
  loading: () => <div style={{ maxWidth: 820, margin: "28px auto", padding: "0 18px" }}><LoadingState title="Opening teacher workspace" body="Loading classes, actions and recent evidence."/></div>,
});
const Student = dynamic(() => import("./Student").then(module => module.Student), {
  loading: () => <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 18px" }}><LoadingState title="Opening your learning" body="Loading this week's quizzes and feedback."/></div>,
});

export function WorkspaceApp() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  // Logged-out visitors land on the marketing front door; "Log in" reveals the auth
  // form. A ?login deep-link (used by the pricing page's "Log in") skips straight to it.
  const [showLogin, setShowLogin] = useState(false);
  const [recovery, setRecovery] = useState(false);   // arrived via a password-reset email link
  const [showAccount, setShowAccount] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
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

  useEffect(() => {
    if (!showUserMenu) return undefined;
    const close = event => {
      if (event.key === "Escape") setShowUserMenu(false);
      if (event.type === "pointerdown" && !event.target.closest?.(".app-user-menu-wrap")) setShowUserMenu(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
  }, [showUserMenu]);

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

  if (restoring) return <div className="app-boot" aria-label="Opening Feynman Education" aria-busy="true"><Brand/><div className="app-boot-line"><span/><span/><span/></div><p>Opening your workspace…</p></div>;
  if (recovery) return <ResetPassword onDone={() => { setRecovery(false); setShowLogin(true); }} />;
  if (!user) return showLogin
    ? <Auth onAuth={setUser} onBack={() => { setShowLogin(false); setWelcome(null); setAuthSignup(false); }} welcome={welcome} startMode={authSignup ? "signup" : undefined} />
    : <Landing pupilArrival={pupilArrival} onLogin={(opts) => { if (opts?.signup) setAuthSignup(true); setShowLogin(true); }} />;
  const teacherSide = isTeacher(user);

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, fontFamily: "var(--font-plex), -apple-system, sans-serif", color: C.txt }}>
      <header className="app-header" style={{ borderBottom: "1px solid rgba(255,255,255,.1)", background: C.panel, color: "#fff", padding: "0 18px", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 5px 18px rgba(17,24,32,.12)" }}>
        <div className="app-header-inner" style={{ maxWidth: teacherSide ? 1440 : 700, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 58, gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Brand href={null} inverse />
            <Badge color={roleColor(user)}>{roleLabel(user)}</Badge>
          </div>
          <div className="app-header-actions">
            <Btn className="app-header-help" v="ghost" onClick={() => setShowSupport(true)} style={{ padding: "7px 11px", minHeight: 36, fontSize: 12, background: "rgba(255,255,255,0.08)", color: "#dbe6ef", border: "1px solid rgba(255,255,255,0.16)" }}><Icon name="info" size={14}/> Help</Btn>
            <div className="app-user-menu-wrap">
              <Btn v="ghost" aria-haspopup="menu" aria-expanded={showUserMenu} onClick={() => setShowUserMenu(open => !open)} style={{ padding: "7px 11px", minHeight: 36, fontSize: 12, background: "rgba(255,255,255,0.08)", color: "#dbe6ef", border: "1px solid rgba(255,255,255,0.16)" }}><Icon name="users" size={14}/> <span className="app-header-account-label">Account</span></Btn>
              {showUserMenu ? <div className="app-user-menu" role="menu"><div className="app-user-menu-name"><strong>{user.profile?.display_name || user.email || "Your account"}</strong><span>{roleLabel(user)}</span></div><button role="menuitem" onClick={() => { setShowUserMenu(false); setShowAccount(true); }}><Icon name="users" size={16}/><span>Account settings</span></button><button className="app-user-menu-help" role="menuitem" onClick={() => { setShowUserMenu(false); setShowSupport(true); }}><Icon name="info" size={16}/><span>Help and support</span></button><button role="menuitem" onClick={() => { setShowUserMenu(false); sb.auth.out(); setUser(null); }}><Icon name="logout" size={16}/><span>Log out</span></button></div> : null}
            </div>
          </div>
        </div>
      </header>
      <ConnectivityBanner />
      {showAccount && <AccountModal user={user} onClose={() => setShowAccount(false)}
        onUpdated={(name) => setUser(u => ({ ...u, user_metadata: { ...u.user_metadata, display_name: name }, profile: { ...u.profile, display_name: name } }))} />}
      {showSupport && <SupportModal user={user} onClose={() => setShowSupport(false)} />}
      <div id="main-content" style={{ paddingBottom: 60 }}>{teacherSide ? <Teacher user={user} /> : <Student user={user} />}</div>
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
