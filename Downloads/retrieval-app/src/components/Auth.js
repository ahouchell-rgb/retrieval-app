"use client";
import { useState } from "react";
import { sb } from "../lib/supabase";
import { attachProfile } from "../lib/roles";
import { C } from "../lib/theme";
import { Btn, Card, Inp } from "./ui";

/* ─── AUTH ─── */
// `welcome` (optional): a summary handed off from a public interactive-science
// booklet (see lib/anonSession.consumeAnonFromUrl). When present we open on the
// signup tab and show a continuity banner — the "claim your progress" bridge.
export function Auth({ onAuth, onBack, welcome }) {
  const [mode, setMode] = useState(welcome ? "signup" : "login");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState("student");
  const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState(false);

  const go = async () => {
    setErr(""); setInfo(""); setBusy(true);
    try {
      if (mode === "forgot") {
        await sb.auth.recover(email);
        setInfo("If that email has an account, a reset link is on its way. Check your inbox (and spam).");
        setBusy(false); return;
      }
      if (mode === "signup") {
        // Teacher/HoD/moderator accounts can only be created by a moderator via the admin panel.
        // Public signups always create students.
        const res = await sb.auth.signUp(email, pw, { display_name: name, role: "student" });
        if (res?.needsConfirm) { setInfo("Check email to confirm, then log in. (Or disable email confirmation in Supabase → Auth → Settings)"); setMode("login"); setBusy(false); return; }
      } else { await sb.auth.signIn(email, pw); }
      onAuth(await attachProfile(sb.auth.user()));
    } catch (e) {
      const m = e.message || "";
      setErr(m.toLowerCase().includes("fetch") || m.toLowerCase().includes("load") ? "Network error — try opening this in a new tab (expand icon top-right), or check that Supabase email confirmation is disabled." : m);
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "var(--font-plex), -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: C.dim, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0, marginBottom: 14 }}>← Home</button>}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.txt, letterSpacing: -0.5 }}>Feynman<span style={{ color: C.pri }}> Education</span></div>
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 14, color: C.dim, marginTop: 6 }}>Retrieval practice that sticks</div>
        </div>
        {welcome && (
          <div style={{ marginBottom: 16, padding: "14px 16px", background: C.grnS, border: `1px solid ${C.grn}`, borderRadius: 8, lineHeight: 1.5 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: C.grn, marginBottom: 4 }}>Welcome from interactive&#8209;science</div>
            <div style={{ fontSize: 14, color: C.txt }}>
              You practised {welcome.attempted} question{welcome.attempted === 1 ? "" : "s"}{welcome.attempted ? ` (${welcome.correct} correct)` : ""}{welcome.topicName ? ` on ${welcome.topicName}` : ""}. Create a free account to keep your streak going and get these spaced back to you.
            </div>
          </div>
        )}
        <Card style={{ padding: "28px 24px" }}>
          {mode === "forgot" ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.txt }}>Reset your password</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>Enter your email and we'll send a reset link.</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 24, marginBottom: 22, borderBottom: `1px solid ${C.bdrSoft}` }}>
              {["login", "signup"].map(m => (
                <button key={m} onClick={() => { setMode(m); setErr(""); setInfo(""); }} style={{ background: "none", border: "none", padding: "0 0 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: mode === m ? 700 : 600, color: mode === m ? C.txt : C.dim, borderBottom: mode === m ? `2.5px solid ${C.pri}` : "2.5px solid transparent", marginBottom: -1 }}>{m === "login" ? "Log in" : "Sign up"}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "signup" && <>
              <Inp placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
              <div style={{ fontSize: 12, color: C.mid, padding: "10px 12px", background: C.card2, borderRadius: 3, borderLeft: `3px solid ${C.amb}`, lineHeight: 1.5 }}>
                You're signing up as a <strong style={{ color: C.txt, fontWeight: 600 }}>student</strong>. Teachers — please ask your admin for an account.
              </div>
            </>}
            <Inp placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && mode === "forgot" && go()} />
            {mode !== "forgot" && <Inp placeholder="Password (min 6)" type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} />}
            {mode === "login" && (
              <button onClick={() => { setMode("forgot"); setErr(""); setInfo(""); }} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: C.pri, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Forgot password?</button>
            )}
            {err && <div style={{ color: C.red, fontSize: 13, padding: "10px 12px", background: C.redS, borderRadius: 8, lineHeight: 1.5 }}>{err}</div>}
            {info && <div style={{ color: C.amb, fontSize: 13, padding: "10px 12px", background: C.ambS, borderRadius: 8, lineHeight: 1.5 }}>{info}</div>}
            <Btn onClick={go} disabled={busy || !email || (mode !== "forgot" && !pw)} style={{ marginTop: 6, width: "100%", ...((busy || !email || (mode !== "forgot" && !pw)) ? { background: C.bg, color: C.dim, border: `1.5px solid ${C.bdr}`, opacity: 1 } : { background: C.txt, color: C.bg }) }}>{busy ? "Working..." : mode === "login" ? "Log in" : mode === "forgot" ? "Send reset link" : "Create account"}</Btn>
            {mode === "forgot" && (
              <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }} style={{ background: "none", border: "none", padding: 0, color: C.dim, fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginTop: 2 }}>← Back to log in</button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─── RESET PASSWORD (after an email recovery link) ─── */
export function ResetPassword({ onDone }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);

  const save = async () => {
    setErr("");
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try { await sb.auth.updatePassword(pw); sb.auth.out(); setDone(true); }
    catch (e) { setErr(e.message || "Could not update password"); }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "var(--font-plex), -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.txt, letterSpacing: -0.5 }}>Feynman<span style={{ color: C.pri }}> Education</span></div>
        </div>
        <Card style={{ padding: "28px 24px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, marginBottom: 16 }}>Choose a new password</div>
          {done ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ color: C.grn, fontSize: 14, padding: "10px 12px", background: C.grnS, borderRadius: 8, lineHeight: 1.5 }}>Password updated. You can log in with it now.</div>
              <Btn onClick={onDone} style={{ width: "100%", background: C.txt, color: C.bg }}>Go to log in</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Inp placeholder="New password (min 6)" type="password" value={pw} onChange={e => setPw(e.target.value)} />
              <Inp placeholder="Confirm new password" type="password" value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
              {err && <div style={{ color: C.red, fontSize: 13, padding: "10px 12px", background: C.redS, borderRadius: 8, lineHeight: 1.5 }}>{err}</div>}
              <Btn onClick={save} disabled={busy || !pw || !pw2} style={{ marginTop: 6, width: "100%", ...((busy || !pw || !pw2) ? { background: C.bg, color: C.dim, border: `1.5px solid ${C.bdr}`, opacity: 1 } : { background: C.txt, color: C.bg }) }}>{busy ? "Saving..." : "Update password"}</Btn>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ─── STUDENT ─── */
/* ─── Question sort: SM-2 due date + teacher recency boost ─── */
// Recency boost pulls recently-taught topic questions forward in the queue.
// Rank 1 = most recently taught → 14-day boost (questions appear as if they were 14 days more overdue)
// Rank 2 → 7-day boost, Rank 3 → 3-day boost
// 50/50 interleave between recent topics (any rank in recencyBoost) and other topics.
// Within each bucket, items are sorted by SM-2 due date (earliest first) with a small
// ±30-min jitter to shuffle ties. A large cooldown penalty shoves questions recently
// answered wrong to the bottom of their bucket for the rest of the session.
// Never-seen questions are treated as due NOW so they compete fairly with past-due items.
// recencyBoost: { topic_id: 1 | 2 | 3 } — rank now only decides bucket membership.
