"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sb, SUPA_URL, SUPA_KEY } from "../../../lib/supabase";
import { C } from "../../../lib/theme";
import { Card, Btn, Badge, TA, Kicker, Headline } from "../../../components/ui";
import { recordAnon, readAnon, handoffUrl } from "../../../lib/anonSession";

/* /embed/practice — the LIVE, answerable retrieval widget embedded (cross-origin,
 * via iframe) into the interactive-science.com revision booklets.
 *
 * It is fully anonymous: questions come from the anon-readable
 * topic_preview_questions RPC (shared bank only, no model answers) and answers are
 * marked by the mark-preview edge function (which resolves the model answer
 * server-side and never records anything). One question at a time keeps it a real
 * retrieval rep, not a wall of text. At the end it offers the conversion bridge:
 * carry your practice into a free account.
 *
 * Params: ?topic=<uuid>&ref=interactive-science&from=<booklet-slug>[&demo=1] */

function postHeight() {
  if (typeof window === "undefined" || window.parent === window) return;
  const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (h > 0) { try { window.parent.postMessage({ type: "iscience:resize", height: h }, "*"); } catch { /* ignore */ } }
}

function PracticeInner() {
  const params = useSearchParams();
  const topicId = params.get("topic") || "";
  const ref = params.get("ref") || "interactive-science";
  const from = params.get("from") || null;
  const demo = params.get("demo") === "1";

  const [topic, setTopic] = useState(undefined); // undefined=loading, null=not found
  const [questions, setQuestions] = useState(null); // null=loading
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [session, setSession] = useState(() => readAnon());
  const [done, setDone] = useState(false);
  const taRef = useRef(null);

  // Keep the host iframe sized to our content. ResizeObserver covers every state
  // change; the booklet HOST script listens for { type:"iscience:resize" }.
  useEffect(() => {
    if (typeof window === "undefined") return;
    postHeight();
    const ro = new ResizeObserver(() => postHeight());
    try { ro.observe(document.documentElement); } catch { /* ignore */ }
    const t = setTimeout(postHeight, 400);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [topic, questions, idx, result, done]);

  useEffect(() => {
    let live = true;
    if (!topicId) { setTopic(null); setQuestions([]); return; }
    (async () => {
      try {
        const t = await sb.q("topics", { params: { id: `eq.${topicId}`, select: "name,key_stage" }, single: true });
        if (live) setTopic(t || null);
      } catch { if (live) setTopic(null); }
      try {
        const qs = await sb.rpc("topic_preview_questions", { p_topic_id: topicId });
        if (live) setQuestions(Array.isArray(qs) ? qs : []);
      } catch { if (live) setQuestions([]); }
    })();
    return () => { live = false; };
  }, [topicId]);

  const q = Array.isArray(questions) ? questions[idx] : null;

  async function check() {
    if (!q || !answer.trim() || busy) return;
    setBusy(true);
    try {
      let verdict;
      if (demo) {
        // Local-only preview of the flow (no deployed function needed): correct if
        // the answer is a real attempt of a few words.
        const ok = answer.trim().split(/\s+/).filter(Boolean).length >= 3;
        verdict = { correct: ok, marks_awarded: ok ? (q.marks || 1) : 0, feedback: ok ? "Correct." : "Have another go — say a bit more about the key idea.", flagged: false, source: "demo" };
      } else {
        const r = await fetch(`${SUPA_URL}/functions/v1/mark-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
          body: JSON.stringify({ question_id: q.id, student_answer: answer.trim() }),
        });
        verdict = await r.json();
        if (r.status === 429 || verdict?.source === "anon_limit") {
          setResult({ limit: true, feedback: verdict?.feedback || "That's all the free practice for now — sign in to keep going." });
          setBusy(false);
          return;
        }
      }
      setResult(verdict);
      const s = recordAnon({ correct: !!verdict.correct, marks: verdict.marks_awarded, topic: topicId, topicName: topic?.name, ref, from });
      setSession(s);
    } catch {
      setResult({ error: true, feedback: "Couldn't reach the marker — check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setResult(null);
    setAnswer("");
    if (idx + 1 < (questions?.length || 0)) { setIdx(idx + 1); setTimeout(() => taRef.current?.focus?.(), 0); }
    else setDone(true);
  }

  const wrap = (children) => (
    <div style={{ fontFamily: C.sans, color: C.txt, padding: "4px 2px 8px", maxWidth: 640, margin: "0 auto" }}>{children}</div>
  );

  // ── Loading / empty states ──
  if (topic === undefined || questions === null) {
    return wrap(<div style={{ color: C.dim, fontSize: 13, padding: "18px 2px" }}>Loading retrieval practice…</div>);
  }
  if (!topicId || topic === null || questions.length === 0) {
    return wrap(
      <Card style={{ padding: 18 }}>
        <Kicker>Retrieval practice</Kicker>
        <div style={{ fontSize: 14, color: C.mid }}>
          {!topicId ? "No topic set for this practice block yet." : "No practice questions for this topic yet — check back soon."}
        </div>
      </Card>
    );
  }

  const openApp = (hash = "") => {
    const url = handoffUrl(typeof window !== "undefined" ? window.location.origin : "https://retrieval-app.com", session || { ref, from, topicName: topic?.name });
    if (typeof window !== "undefined") window.open(url + hash, "_blank", "noopener");
  };

  const CTA = ({ title, sub }) => (
    <Card style={{ padding: 20, borderColor: C.pri, borderLeft: `4px solid ${C.pri}`, background: C.priSoftBg }}>
      <Kicker>Make it stick</Kicker>
      <div style={{ fontFamily: C.serif, fontSize: 19, fontWeight: 600, lineHeight: 1.3, marginBottom: 6, color: C.txt }}>{title}</div>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 16 }}>{sub}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn onClick={() => openApp("#signup")}>Create a free account ↗</Btn>
        <Btn v="ghost" onClick={() => openApp()}>I already have one</Btn>
      </div>
    </Card>
  );

  // ── End screen ──
  if (done) {
    const att = session?.attempted || 0, cor = session?.correct || 0;
    return wrap(
      <>
        <Kicker>Nice work</Kicker>
        <Headline size={22} style={{ marginBottom: 4 }}>You scored {cor} / {att}</Headline>
        <div style={{ fontSize: 13, color: C.mid, marginBottom: 16 }}>on {topic.name} retrieval practice.</div>
        <CTA
          title="Lock it in — don't let it fade."
          sub="Create a free account and these come back to you spaced just right, so it actually sticks. You can pick up exactly where you left off."
        />
        <div style={{ marginTop: 14 }}>
          <Btn v="ghost" onClick={() => { setIdx(0); setDone(false); setResult(null); setAnswer(""); }}>Practise again</Btn>
        </div>
      </>
    );
  }

  // ── Active question ──
  const verdict = result && !result.error && !result.limit ? result : null;
  return wrap(
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <Kicker style={{ marginBottom: 0 }}>Retrieval practice</Kicker>
        {topic.key_stage ? <Badge color={C.acc}>{topic.key_stage}</Badge> : null}
      </div>
      <Headline size={22} style={{ marginBottom: 8 }}>{topic.name}</Headline>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
        <span>Question {idx + 1} of {questions.length}</span>
        {session?.attempted ? <span>{session.correct}/{session.attempted} so far</span> : null}
      </div>

      <Card style={{ padding: "16px 16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontSize: 15, lineHeight: 1.45, flex: 1 }}>{q.question_text}</div>
          <span style={{ fontSize: 10, fontWeight: 600, color: C.mid, whiteSpace: "nowrap" }}>{q.marks} mark{q.marks === 1 ? "" : "s"}</span>
        </div>
        {q.image_url ? <img src={q.image_url} alt="" style={{ maxWidth: "100%", marginBottom: 12, borderRadius: 4, border: `1px solid ${C.bdr}` }} /> : null}

        {!verdict ? (
          <>
            <TA
              ref={taRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) check(); }}
              placeholder="Type your answer…"
              rows={3}
              disabled={busy}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Btn onClick={check} disabled={busy || !answer.trim()}>{busy ? "Marking…" : "Check answer"}</Btn>
              <span style={{ fontSize: 11, color: C.dim }}>Model answers stay hidden — you get marked feedback.</span>
            </div>
          </>
        ) : (
          <>
            <div style={{
              padding: "12px 14px", borderRadius: 3, marginBottom: 12,
              background: verdict.correct ? C.grnSoft : C.redSoft,
              border: `1px solid ${verdict.correct ? C.grn : C.red}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: verdict.correct ? C.grn : C.red, marginBottom: 4 }}>
                {verdict.correct ? "Correct" : verdict.flagged ? "Have another look" : "Not quite"} · {verdict.marks_awarded}/{q.marks}
              </div>
              <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.45 }}>{verdict.feedback}</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8, fontStyle: "italic" }}>Your answer: {answer}</div>
            </div>
            <Btn onClick={next}>{idx + 1 < questions.length ? "Next question →" : "See your results →"}</Btn>
          </>
        )}

        {result?.error ? <div style={{ fontSize: 13, color: C.red, marginTop: 10 }}>{result.feedback}</div> : null}
      </Card>

      {result?.limit ? (
        <div style={{ marginTop: 14 }}>
          <CTA title="That's the free practice for now." sub={result.feedback} />
        </div>
      ) : null}
    </>
  );
}

export default function EmbedPracticePage() {
  return (
    <Suspense fallback={<div style={{ fontFamily: C.sans, color: C.dim, fontSize: 13, padding: 18 }}>Loading…</div>}>
      <PracticeInner />
    </Suspense>
  );
}
