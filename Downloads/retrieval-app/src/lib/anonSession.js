/* Anonymous practice session — the honest "claim your progress" bridge.
 *
 * A visitor practising in the public booklet embed (/embed/practice) has no
 * account, so we can't (and shouldn't) write class-scoped grades for them. What
 * we CAN do is remember that they practised and carry that across to the real app
 * when they sign up, so the first thing they see is continuity, not a cold start.
 *
 * Storage reality: the embed runs cross-origin inside an interactive-science.com
 * page, so its localStorage is PARTITIONED — it is NOT the same store the app sees
 * at retrieval-app.com top-level. So this module does two jobs:
 *   - embed side: accumulate the running session in (partitioned) localStorage for
 *     within-visit continuity, and build a tiny handoff URL;
 *   - app side: read that handoff back off the URL (the only channel that crosses
 *     the storage partition) and show a welcome.
 * We pass only COUNTS across the boundary — never answers — because nothing is
 * being recorded as a grade. */

const KEY = "retrieval.anonPractice";

export function readAnon() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(KEY) || "null"); } catch { return null; }
}

// Record one marked answer into the running embed-side session. Returns the
// updated session so the caller can render live progress.
export function recordAnon({ correct, marks, topic, topicName, ref, from }) {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const prev = readAnon() || { attempted: 0, correct: 0, marks: 0, days: [], firstTs: now };
  const s = {
    attempted: (prev.attempted || 0) + 1,
    correct: (prev.correct || 0) + (correct ? 1 : 0),
    marks: (prev.marks || 0) + (Number(marks) || 0),
    days: Array.from(new Set([...(prev.days || []), day])),
    firstTs: prev.firstTs || now,
    lastTs: now,
    ref: prev.ref || ref || null,
    from: from || prev.from || null,
    topic: topic || prev.topic || null,
    topicName: topicName || prev.topicName || null,
  };
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode / quota */ }
  return s;
}

export function clearAnon() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Build the top-level app URL that carries the session across the storage
// partition. Opened in a new (first-party) tab, so the app reads its own
// first-party localStorage afterwards.
export function handoffUrl(origin, session) {
  const u = new URL("/", origin);
  u.searchParams.set("isci", "1");
  if (session?.attempted) u.searchParams.set("att", String(session.attempted));
  if (session?.correct != null) u.searchParams.set("cor", String(session.correct));
  if (session?.ref) u.searchParams.set("ref", session.ref);
  if (session?.from) u.searchParams.set("from", session.from);
  if (session?.topicName) u.searchParams.set("topic", session.topicName);
  return u.toString();
}

// App side: read a handoff off the current URL (the cross-partition channel).
// Returns the summary, or null if this isn't an interactive-science arrival.
export function consumeAnonFromUrl() {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("isci") !== "1") return null;
    const summary = {
      attempted: Number(p.get("att")) || 0,
      correct: Number(p.get("cor")) || 0,
      ref: p.get("ref") || "interactive-science",
      from: p.get("from") || null,
      topicName: p.get("topic") || null,
    };
    return summary;
  } catch {
    return null;
  }
}
