import { detectFakeAnswer, localMark } from "./marking";

// Supabase project URL + anon key. The anon key is public by design (it is
// shipped to the browser and RLS is what protects data), but reading it from
// env lets you rotate it / point at a different project without code changes.
// Falls back to the original literals so existing deployments keep working
// even if NEXT_PUBLIC_SUPA_* aren't set. See .env.example.
export const SUPA_URL = process.env.NEXT_PUBLIC_SUPA_URL || "https://uvzukwoxqhcxaxtzrziy.supabase.co";
export const SUPA_KEY = process.env.NEXT_PUBLIC_SUPA_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2enVrd294cWhjeGF4dHpyeml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyNTIsImV4cCI6MjA4OTkyMTI1Mn0.PtT24EfMfTckYaq9jXBPRuCsG6utWMLcHs9H8buM70c";

/* ─── Paginated fetch ───
 * A single PostgREST request is capped at the server's max-rows, and these
 * dashboards used a hard `limit: "10000"` / "5000" that silently undercounts
 * once a class / the platform passes that ceiling. paginate() walks the table
 * in batches (advancing offset by what's collected) until a page comes back
 * empty, so aggregates stay correct at any data volume. Pure & testable: it
 * just calls fetchPage(offset, batch) repeatedly. */
export async function paginate(fetchPage, { batch = 1000, max = 500000 } = {}) {
  const out = [];
  while (out.length < max) {
    const page = await fetchPage(out.length, batch);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
  }
  return out;
}

/* ─── Supabase client ───
 * Hand-rolled REST/auth client. The session ({access,refresh} token + user) is
 * persisted to localStorage so a page reload doesn't log the user out, and the
 * access token is refreshed before it expires (and again on a 401) so a class
 * session running longer than the ~1h token lifetime doesn't silently break. */
export const sb = (() => {
  const STORAGE_KEY = "retrieval.session";
  let token = null, refreshToken = null, expiresAt = 0, user = null;

  const persist = () => {
    if (typeof window === "undefined") return;
    try {
      if (token) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, refreshToken, expiresAt, user }));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode / quota — session just won't survive reloads */ }
  };

  // Restore any persisted session on module load.
  if (typeof window !== "undefined") {
    try {
      const s = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (s && s.token) { token = s.token; refreshToken = s.refreshToken || null; expiresAt = s.expiresAt || 0; user = s.user || null; }
    } catch { /* ignore corrupt storage */ }
  }

  const setSession = (d) => {
    token = d.access_token;
    refreshToken = d.refresh_token || refreshToken;
    // Supabase returns expires_at (unix seconds) and/or expires_in (seconds).
    expiresAt = d.expires_at ? d.expires_at * 1000 : Date.now() + ((d.expires_in || 3600) * 1000);
    if (d.user) user = d.user;
    persist();
  };
  const clearSession = () => { token = null; refreshToken = null; expiresAt = 0; user = null; persist(); };

  // Single-flight refresh: concurrent requests share one network call.
  let refreshing = null;
  const refresh = () => {
    if (!refreshToken) return Promise.resolve(false);
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.access_token) { clearSession(); return false; }
          setSession(d);
          return true;
        } catch { return false; }
        finally { refreshing = null; }
      })();
    }
    return refreshing;
  };

  // Refresh proactively when within 60s of expiry (clock-skew cushion).
  const ensureFresh = async () => {
    if (token && expiresAt && Date.now() > expiresAt - 60000) await refresh();
  };

  const h = (x = {}) => ({ "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token || SUPA_KEY}`, ...x });

  const q = async (tbl, { method = "GET", body, params = {}, single } = {}) => {
    await ensureFresh();
    const u = new URL(`${SUPA_URL}/rest/v1/${tbl}`);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const send = () => {
      const hd = h();
      if (single) hd["Accept"] = "application/vnd.pgrst.object+json";
      if (method === "POST" || method === "PATCH") hd["Prefer"] = "return=representation";
      return fetch(u, { method, headers: hd, body: body ? JSON.stringify(body) : undefined });
    };
    let r = await send();
    // A token that expired between ensureFresh and now (or was revoked) — refresh once and retry.
    if (r.status === 401 && token && await refresh()) r = await send();
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `${method} ${tbl} failed`); }
    if (method === "DELETE") return null;
    return r.json();
  };

  const del = async (tbl, p = {}) => {
    await ensureFresh();
    const u = new URL(`${SUPA_URL}/rest/v1/${tbl}`);
    Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
    const send = () => fetch(u, { method: "DELETE", headers: h() });
    let r = await send();
    if (r.status === 401 && token && await refresh()) r = await send();
    // Previously this ignored the response entirely, so RLS denials / network
    // failures looked like successful deletes. Surface them.
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `DELETE ${tbl} failed`); }
    return null;
  };

  // Fetch every matching row across pages. Drops any caller-supplied limit/offset
  // and manages them itself. Use for aggregation reads that must not be capped.
  const qAll = (tbl, { params = {}, batch, max } = {}) => {
    const { limit, offset, ...rest } = params;
    return paginate(
      (off, lim) => q(tbl, { params: { ...rest, limit: String(lim), offset: String(off) } }),
      { batch, max }
    );
  };

  // Call a Postgres function (RPC). Used for SECURITY DEFINER operations that
  // must be validated server-side — e.g. joining a class by code (so join codes
  // don't need to be world-readable and a pupil can't enrol in an arbitrary class).
  const rpc = async (fn, args = {}) => {
    await ensureFresh();
    const u = `${SUPA_URL}/rest/v1/rpc/${fn}`;
    const send = () => fetch(u, { method: "POST", headers: h(), body: JSON.stringify(args) });
    let r = await send();
    if (r.status === 401 && token && await refresh()) r = await send();
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `rpc ${fn} failed`); }
    return r.json();
  };

  /* ─── Authoritative answer submission + offline resilience ───
   * The mark-answer edge function is the single source of truth for the grade
   * AND the writer of the responses row, so the browser can't mark itself
   * correct (see supabase/functions/mark-answer). On a network failure we queue
   * the submission and replay it through the function later — never a
   * client-chosen grade — so a dropped request on flaky school wifi neither
   * loses the answer nor opens a forgery path. */
  const PENDING_KEY = "retrieval.pendingAnswers";
  const readPending = () => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(window.localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; }
  };
  const writePending = (list) => {
    if (typeof window === "undefined") return;
    try {
      if (list.length) window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
      else window.localStorage.removeItem(PENDING_KEY);
    } catch { /* quota — best effort */ }
  };

  // POST one submission to the marking function. Sends the user's JWT so the
  // function can identify the pupil and record server-side. Throws on a network
  // / non-2xx failure. Returns { correct, marks_awarded, feedback, flagged,
  // source, recorded, response_id }.
  const callMarkAnswer = async (payload) => {
    await ensureFresh();
    const headers = { "Content-Type": "application/json", apikey: SUPA_KEY };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch(`${SUPA_URL}/functions/v1/mark-answer`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`mark-answer ${r.status}`);
    return r.json();
  };

  let flushing = false;
  const flushAnswers = async () => {
    if (flushing || !token) return;
    flushing = true;
    try {
      let pending = readPending();
      while (pending.length) {
        let res;
        try { res = await callMarkAnswer(pending[0]); } catch { break; }   // still offline
        if (!res?.recorded) break;                                         // reachable but not storing — keep queued
        pending = pending.slice(1);
        writePending(pending);
      }
    } finally { flushing = false; }
  };

  // Mark + record one answer authoritatively. Always returns a verdict for the
  // UI: recorded:true (with response_id) when the server stored it, or
  // queued:true when saved to retry. The grade always comes from the server.
  const submitAnswer = async (payload) => {
    flushAnswers().catch(() => {});      // opportunistically drain earlier failures
    // The non-attempt heuristic is science-shaped (short words, no-vowel mashing).
    // Maths working is too varied for it — multi-line working, symbolic and very
    // short answers are all legitimate — so skip the client pre-flag for maths and
    // let the maths marking overlay judge. (skipFakeCheck never reaches the wire.)
    const { skipFakeCheck, ...rest } = payload;
    const fake = skipFakeCheck ? null : detectFakeAnswer(payload.student_answer);
    const body = { ...rest, prejudged_flagged: fake || undefined };
    try {
      const d = await callMarkAnswer(body);
      const verdict = { correct: !!d.correct, marks_awarded: d.marks_awarded ?? 0, feedback: d.feedback, flagged: !!d.flagged, source: d.source };
      if (d.recorded) return { ...verdict, recorded: true, response_id: d.response_id ?? null };
      // Reached the function but it didn't store (transient, or pre-lock-in).
      // Persist the SERVER's verdict directly so nothing is lost; once the
      // client-INSERT lock-in lands this fails and falls through to the queue.
      try {
        const rows = await q("responses", { method: "POST", body: {
          student_id: payload.student_id, question_id: payload.question_id, class_id: payload.class_id,
          student_answer: payload.student_answer, is_correct: verdict.correct,
          ai_feedback: verdict.flagged ? "FLAGGED: " + verdict.feedback : verdict.feedback, marks_awarded: verdict.marks_awarded,
        } });
        const row = Array.isArray(rows) ? rows[0] : rows;
        return { ...verdict, recorded: true, response_id: row?.id ?? null };
      } catch {
        writePending([...readPending(), body]);
        return { ...verdict, recorded: false, queued: true, response_id: null };
      }
    } catch {
      // Offline: optimistic local verdict for instant feedback; the authoritative
      // mark is recorded by the function when this submission replays.
      writePending([...readPending(), body]);
      const local = fake
        ? { correct: false, marks_awarded: 0, feedback: fake, flagged: true }
        : localMark(payload.question, payload.model_answer, payload.student_answer, payload.marks);
      return { ...local, source: "queued_local", recorded: false, queued: true, response_id: null };
    }
  };

  const auth = {
    signUp: async (email, pw, meta = {}) => {
      const r = await fetch(`${SUPA_URL}/auth/v1/signup`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPA_KEY }, body: JSON.stringify({ email, password: pw, data: meta }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error?.message || d.msg || "Signup failed");
      if (d.access_token) setSession(d); else if (d.id) return { needsConfirm: true };
      return d;
    },
    signIn: async (email, pw) => {
      const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPA_KEY }, body: JSON.stringify({ email, password: pw }) });
      const d = await r.json();
      if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error?.message || "Login failed");
      setSession(d); flushAnswers().catch(() => {}); return d;
    },
    out: () => clearSession(),
    user: () => user,
    getToken: () => token,
    // Re-establish a persisted session across reloads. Refreshes a stale token;
    // returns the user (caller re-fetches the profile) or null if none/expired.
    restore: async () => {
      if (!token && !refreshToken) return null;
      await ensureFresh();
      if (!token && refreshToken) await refresh();
      if (token) flushAnswers().catch(() => {});   // resend answers queued before the reload
      return token ? user : null;
    },
    // Send a password-reset email (Supabase emails a recovery link).
    recover: async (email) => {
      const r = await fetch(`${SUPA_URL}/auth/v1/recover`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPA_KEY }, body: JSON.stringify({ email }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error_description || d.msg || d.error?.message || "Could not send reset email"); }
      return true;
    },
    // Change the signed-in user's password (self-service, or during recovery).
    updatePassword: async (newPassword) => {
      await ensureFresh();
      const r = await fetch(`${SUPA_URL}/auth/v1/user`, { method: "PUT", headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: newPassword }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error_description || d.msg || d.error?.message || "Could not update password");
      return d;
    },
    // Change the signed-in user's display name (auth metadata + profiles row).
    updateName: async (display_name) => {
      await ensureFresh();
      const r = await fetch(`${SUPA_URL}/auth/v1/user`, { method: "PUT", headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { display_name } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error_description || d.msg || d.error?.message || "Could not update name");
      if (d && d.id) { user = d; persist(); }
      try { if (user?.id) await q("profiles", { method: "PATCH", params: { id: `eq.${user.id}` }, body: { display_name } }); } catch { /* RLS/offline — auth metadata still updated */ }
      return d;
    },
    // Recovery deep-link: Supabase returns the user with tokens in the URL hash
    // (#access_token=…&type=recovery). Apply them as a session so the user can set
    // a new password. Returns true when a recovery link was handled.
    applyRecovery: () => {
      if (typeof window === "undefined") return false;
      const hash = window.location.hash || "";
      if (!hash.includes("type=recovery") || !hash.includes("access_token")) return false;
      const p = new URLSearchParams(hash.replace(/^#/, ""));
      const access_token = p.get("access_token");
      if (!access_token) return false;
      setSession({ access_token, refresh_token: p.get("refresh_token"), expires_in: Number(p.get("expires_in")) || 3600 });
      try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
      return true;
    },
  };
  /* ─── Public revision-booklet map (topic_id -> booklet) ───
   * Loads the anon-readable topic_booklets table once and caches it, so any
   * weak-topic surface can offer a "Revise this →" deep-link to the matching
   * public interactive-science.com booklet. Closes the loop: practice reveals
   * the gap, the booklet revises it. Best-effort — never throws to the caller. */
  let bookletMap = null, bookletLoading = null;
  const loadBooklets = () => {
    if (bookletMap) return Promise.resolve(bookletMap);
    if (!bookletLoading) {
      bookletLoading = q("topic_booklets", { params: { select: "topic_id,slug,url" } })
        .then((rows) => {
          bookletMap = {};
          (Array.isArray(rows) ? rows : []).forEach((r) => { if (r?.topic_id) bookletMap[r.topic_id] = r; });
          return bookletMap;
        })
        .catch(() => { bookletMap = {}; return bookletMap; });
    }
    return bookletLoading;
  };
  const bookletFor = (topicId) => (bookletMap && topicId ? bookletMap[topicId] || null : null);

  return { q, del, qAll, rpc, auth, submitAnswer, flushAnswers, pendingAnswers: () => readPending().length, loadBooklets, bookletFor };
})();
