"use client";
import { useState, useEffect, useRef } from "react";
import { detectFakeAnswer } from "../lib/marking";
import { getSRInfo, sortQuestions } from "../lib/questions";
import { nextSR } from "../lib/sr";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { STAR_INTERVAL, WEEKLY_TARGET, getWeekBounds } from "../lib/week";
import { MathInput } from "./MathInput";
import { StudentPaperAttempt } from "./StudentPaperAttempt";
import { Badge, Btn, Card, Dateline, Deck, Headline, Inp, Kicker, Pill, TA } from "./ui";

// Small inline icon for a revision resource link. Booklets/PDFs get a book;
// interactive tools/widgets get a "spark" so the two read differently at a glance.
function ResIcon({ kind, color }) {
  if (kind === "booklet" || kind === "pdf") {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  }
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>;
}

export function Student({ user }) {
  // Gamification UI toggle. false = editorial "one focal point" student view
  // (streak banner, 7-day strip, milestone overlay, star-pop, streak/star badges,
  // and in-card star progress all hidden). Underlying streak/star/habit computation
  // is left intact and dormant — flip to true to restore the full motivational UI.
  const SHOW_GAMIFICATION = false;
  const [classes, setClasses] = useState([]);
  const [cls, setCls] = useState(null);
  // Paper-taking state — when set, the page swaps to the paper attempt view
  const [paperBeingTaken, setPaperBeingTaken] = useState(null); // { id, mode, topic_id }
  const [assignedPapers, setAssignedPapers] = useState([]);     // papers attached to current class
  const [paperResponses, setPaperResponses] = useState([]);     // student's own paper answers (last 60 days)
  const [qs, setQs] = useState([]);
  const [qi, setQi] = useState(0);
  const [ans, setAns] = useState("");
  const [res, setRes] = useState(null);
  const [marking, setMarking] = useState(false);
  const [stats, setStats] = useState({ t: 0, c: 0 });
  const [sr, setSr] = useState({});
  const [recency, setRecency] = useState({}); // topicId → rank (1/2/3)
  const [correctStreak, setCorrectStreak] = useState(0); // session-only: consecutive correct answers, resets on wrong
  // Daily-practice streak — derived from habitDays in an effect once habit data loads
  const [dailyStreak, setDailyStreak] = useState(0);
  const [streakBumped, setStreakBumped] = useState(false); // brief animation state when streak goes up
  const [milestone, setMilestone] = useState(null); // {n} when a streak milestone hit, drives celebration overlay
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const [joining, setJoining] = useState(false);
  // Self-serve onboarding (a fresh, unaffiliated account starting a school)
  const [schoolName, setSchoolName] = useState("");
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [weeklyValid, setWeeklyValid] = useState(0);
  const [weeklyData, setWeeklyData] = useState([]);
  const [showWeeks, setShowWeeks] = useState(false);
  const [starPop, setStarPop] = useState(false);
  const [topicStats, setTopicStats] = useState([]); // [{topicId, name, t, c, notStarted}]
  const [showTopics, setShowTopics] = useState(false);
  const [topicResources, setTopicResources] = useState({}); // topicId → [{kind,title,url,sort_order}] from interactive-science.com
  const [statView, setStatView] = useState("allTime"); // "allTime" | "thisWeek"
  const [sessionStats, setSessionStats] = useState({ t: 0, c: 0, topics: [], struggles: [] });
  const [showSummary, setShowSummary] = useState(false);
  const [sessionHitTarget, setSessionHitTarget] = useState(false);
  const [studyMode, setStudyMode] = useState(false);
  const [studyTopicId, setStudyTopicId] = useState(null);
  // Session-level "wrong answer cooldown" — maps questionId -> how many MORE questions must be answered before this one can resurface.
  // Prevents the same wrong question cycling back within seconds. Resets on reload (in-memory only).
  const [cooldown, setCooldown] = useState(new Map());
  const COOLDOWN_LENGTH = 12; // answer 12 other questions before a wrong one can return
  // Session progress counter (resets on class pick or Back)
  const [sessionQCount, setSessionQCount] = useState(0);
  // Per-session target that drives the progress bar — remainder of weekly target, min 5, max 15
  const [sessionTarget, setSessionTarget] = useState(10);
  // Report wrong marking
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagMsg, setFlagMsg] = useState("");
  const [lastResponseId, setLastResponseId] = useState(null);
  // 7-day habit visual: [{ date, label, count }]
  const [habitDays, setHabitDays] = useState([]);
  // Review mistakes mode: filters qs to those student has recently got wrong
  const [reviewMode, setReviewMode] = useState(false);
  const [mistakeQIds, setMistakeQIds] = useState(new Set()); // recent wrong qids for review mode
  // Session-intro framing: show a "here's your session" card before first question
  const [sessionStarted, setSessionStarted] = useState(false);
  // Voice input state (Web Speech API)
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const recognitionRef = useRef(null);
  const ansBaseRef = useRef("");

  useEffect(() => { load(); }, []);

  // ── Daily streak ──────────────────────────────────────────────────────────
  // Computed from habitDays. The streak is the count of consecutive days, ending
  // either today (if the student has practised today) or yesterday (if today is
  // still in progress). A "streak freeze" — stored per-user in localStorage —
  // can save one missed day. We only auto-grant a freeze when the student earns
  // a 7-day streak; freezes are capped at 1 active at any time so they don't
  // trivialise the habit.
  const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
  const freezeKey = `streak_freeze_${user.id}`;
  const milestonesShownKey = `streak_milestones_shown_${user.id}`;

  useEffect(() => {
    if (habitDays.length === 0) return;
    // habitDays is oldest -> today. Walk backwards.
    let count = 0;
    let usedFreeze = false;
    let availableFreeze = false;
    try { availableFreeze = window.localStorage.getItem(freezeKey) === "1"; } catch {}
    const todayActive = habitDays[habitDays.length - 1].count > 0;
    // Start point: today if active, else yesterday (so the streak doesn't look
    // broken just because the student opens the app before practising).
    const startIdx = todayActive ? habitDays.length - 1 : habitDays.length - 2;
    for (let i = startIdx; i >= 0; i--) {
      if (habitDays[i].count > 0) {
        count++;
      } else if (availableFreeze && !usedFreeze) {
        // Burn the freeze on the first missed day, keep streak going.
        usedFreeze = true;
      } else {
        break;
      }
    }
    setDailyStreak(prev => {
      if (count > prev && prev > 0) {
        // Animate the bump
        setStreakBumped(true);
        setTimeout(() => setStreakBumped(false), 1200);
      }
      // Auto-grant a freeze when crossing the 7-day mark for the first time
      // (and not already holding one). Only on transitions, not on every render.
      if (count >= 7 && prev < 7 && !availableFreeze) {
        try { window.localStorage.setItem(freezeKey, "1"); } catch {}
      }
      // Milestone celebration — only fire on transitions and only once per milestone.
      const milestoneHit = STREAK_MILESTONES.find(m => count >= m && prev < m);
      if (milestoneHit) {
        let shown = [];
        try { shown = JSON.parse(window.localStorage.getItem(milestonesShownKey) || "[]"); } catch {}
        if (!shown.includes(milestoneHit)) {
          setMilestone({ n: milestoneHit });
          try { window.localStorage.setItem(milestonesShownKey, JSON.stringify([...shown, milestoneHit])); } catch {}
        }
      }
      return count;
    });
  }, [habitDays]);

  // Initialise Web Speech API once per mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSpeechSupported(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const base = ansBaseRef.current;
      setAns(((base && base.trim()) ? base.trim() + " " : "") + transcript.trim());
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = (e) => {
      const msg = e?.error === "not-allowed" ? "Mic access blocked — enable it in browser settings"
                : e?.error === "no-speech" ? "Didn't hear anything — try again"
                : e?.error === "network" ? "Network issue with speech recognition"
                : "Couldn't transcribe — try typing";
      setSpeechError(msg);
      setIsRecording(false);
      setTimeout(() => setSpeechError(""), 3500);
    };
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch { /* no-op */ } };
  }, []);

  const toggleMic = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (isRecording) {
      try { rec.stop(); } catch { /* no-op */ }
      setIsRecording(false);
    } else {
      ansBaseRef.current = ans;
      setSpeechError("");
      try { rec.start(); setIsRecording(true); }
      catch (e) { console.warn("speech start failed", e); }
    }
  };

  const stopMicIfActive = () => {
    if (isRecording && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* no-op */ }
      setIsRecording(false);
    }
  };

  const load = async () => {
    try {
      const mems = await sb.q("class_members", { params: { student_id: `eq.${user.id}`, select: "class_id" } });
      if (mems.length) {
        const ids = mems.map(m => m.class_id);
        const c = await sb.q("classes", { params: { id: `in.(${ids.join(",")})`, select: "*,subjects(name,marker_profile)" } });
        setClasses(c);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const joinClass = async () => {
    if (!joinCode.trim()) return;
    setJoinErr(""); setJoining(true);
    try {
      const code = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      // Joining is validated + enrolled server-side: the RPC looks up the class by
      // code and adds the membership. So join codes aren't world-readable and a
      // pupil can't enrol in an arbitrary class. Idempotent — re-joining is fine.
      const rows = await sb.rpc("join_class_by_code", { p_code: code });
      if (!rows || !rows.length) { setJoinErr("No class found with that code. Check with your teacher."); setJoining(false); return; }
      const joined = rows[0];
      // Now enrolled, so classes_select lets us read the full row for the UI.
      let full = joined;
      try { full = await sb.q("classes", { params: { id: `eq.${joined.id}`, select: "*,subjects(name,marker_profile)" }, single: true }); } catch { /* fall back to id+name */ }
      setClasses(p => p.some(x => x.id === joined.id) ? p : [...p, full]);
      setJoinCode("");
    } catch (e) { setJoinErr(e.message); }
    setJoining(false);
  };

  // Self-serve onboarding: an unaffiliated account can stand up its own school
  // (create_school makes the caller a school lead). Reload so the app re-routes to
  // the teacher side as the new 'hod'.
  const startSchool = async () => {
    if (!schoolName.trim()) return;
    setCreatingSchool(true); setCreateErr("");
    try {
      await sb.rpc("create_school", { p_name: schoolName.trim() });
      if (typeof window !== "undefined") window.location.reload();
    } catch (e) { setCreateErr(e.message || "Could not create the school"); setCreatingSchool(false); }
  };

  const pickClass = async (c) => {
    setCls(c);
    setSessionStats({ t: 0, c: 0, topics: [], struggles: [] });
    setShowSummary(false);
    setSessionHitTarget(false);
    setStudyMode(false);
    setStudyTopicId(null);
    setSessionQCount(0);
    setFlagMsg("");
    try {
      const ul = await sb.q("class_topics", { params: { class_id: `eq.${c.id}`, select: "topic_id,recency_rank" } });
      if (!ul.length) { setQs([]); return; }
      const tids = ul.map(t => t.topic_id);

      // Build recency boost map: topicId → rank (1=most recent, 2, 3)
      const recencyBoost = {};
      ul.forEach(t => { if (t.recency_rank) recencyBoost[t.topic_id] = t.recency_rank; });
      setRecency(recencyBoost);

      const questions = await sb.q("questions", { params: { topic_id: `in.(${tids.join(",")})`, archived: "eq.false", select: "*,topics(name)" } });
      const resps = await sb.q("responses", { params: { student_id: `eq.${user.id}`, class_id: `eq.${c.id}`, select: "question_id,is_correct,student_answer,answered_at", order: "answered_at.desc" } });

      const srMap = {};
      const byQ = {};
      resps.forEach(r => { if (!byQ[r.question_id]) byQ[r.question_id] = []; byQ[r.question_id].push(r); });
      Object.entries(byQ).forEach(([qid, rs]) => {
        let s = { ef: 2.5, iv: 0, reps: 0 };
        rs.reverse().forEach(r => { s = nextSR(r.is_correct, s); });
        srMap[qid] = s;
      });
      setSr(srMap);

      // Build per-topic accuracy from responses
      const qMap = {}; questions.forEach(q => { qMap[q.id] = q; });
      const tAcc = {}; // topicId → {topicId, name, t, c}
      questions.forEach(q => {
        if (!tAcc[q.topic_id]) tAcc[q.topic_id] = { topicId: q.topic_id, name: q.topics?.name || "Unknown", t: 0, c: 0 };
      });
      resps.forEach(r => {
        const q = qMap[r.question_id];
        if (q && tAcc[q.topic_id]) { tAcc[q.topic_id].t++; if (r.is_correct) tAcc[q.topic_id].c++; }
      });
      const attempted = Object.values(tAcc).filter(t => t.t > 0).sort((a, b) => (a.c/a.t) - (b.c/b.t));
      const notStarted = Object.values(tAcc).filter(t => t.t === 0).length;
      setTopicStats([...attempted, ...(notStarted > 0 ? [{ name: `${notStarted} topic${notStarted !== 1 ? "s" : ""} not yet started`, t: 0, c: 0, isPlaceholder: true }] : [])]);

      // Topic-level revision resources (interactive-science.com tools/widgets/booklets),
      // keyed by topic id — powers the "revise your weak spots" panel below.
      try {
        const trs = await sb.q("topic_resources", { params: { retrieval_topic_id: `in.(${tids.join(",")})`, select: "retrieval_topic_id,kind,title,url,sort_order", order: "sort_order.asc" } });
        const trMap = {};
        (trs || []).forEach(r => { if (!trMap[r.retrieval_topic_id]) trMap[r.retrieval_topic_id] = []; trMap[r.retrieval_topic_id].push(r); });
        setTopicResources(trMap);
      } catch (e) { console.error("resource load failed", e); setTopicResources({}); }

      // Public revision booklets keyed by topic — adds a "Revision booklet →" link
      // to each weak spot (the reverse of the booklet → practice loop).
      try { await sb.loadBooklets(); } catch { /* booklets are best-effort */ }

      setQs(sortQuestions(questions, srMap, recencyBoost, new Set()));
      setQi(0); setAns(""); setRes(null);
      setStats({ t: resps.length, c: resps.filter(r => r.is_correct).length });

      // Load papers assigned to this class and the student's attempts on each paper.
      // Per-paper we keep:
      //   latest: the most recent attempt (submitted or in-progress) — drives the home card
      //   submittedCount: number of submitted attempts so far — for the "Retake →" UX
      // ALSO load all of this student's paper_responses for the last 60 days — these count
      // toward weeklyValid, the habit strip, and the 8-week history (papers reward students
      // the same way retrieval does: 1 unit per non-flagged paper answer).
      let paperResps = [];
      try {
        const [pcas, pAttempts] = await Promise.all([
          sb.q("paper_class_assignments", { params: { class_id: `eq.${c.id}`, select: "paper_id,papers(id,name,total_marks,exam_board,paper_year,paper_number,archived)" } }),
          sb.q("paper_attempts", { params: { student_id: `eq.${user.id}`, class_id: `eq.${c.id}`, mode: `eq.full`, select: "id,paper_id,submitted_at,awarded_marks,total_marks,started_at", order: "started_at.desc" } }),
        ]);
        if (pAttempts && pAttempts.length > 0) {
          const sixtyAgo = new Date(); sixtyAgo.setDate(sixtyAgo.getDate() - 60);
          const attemptIds = pAttempts.map(a => a.id);
          paperResps = await sb.q("paper_responses", {
            params: {
              attempt_id: `in.(${attemptIds.join(",")})`,
              answered_at: `gte.${sixtyAgo.toISOString()}`,
              flagged: "eq.false",
              select: "id,attempt_id,answered_at,marks_awarded",
            },
          }) || [];
        }
        const byPaper = {};
        (pAttempts || []).forEach(a => {
          if (!byPaper[a.paper_id]) byPaper[a.paper_id] = { all: [], submitted: [], latest: null, latestSubmitted: null };
          byPaper[a.paper_id].all.push(a);
          if (a.submitted_at) byPaper[a.paper_id].submitted.push(a);
        });
        Object.values(byPaper).forEach(g => {
          // ordered started_at desc, so [0] is newest
          g.latest = g.all[0] || null;
          // latest submitted attempt (could be the same as latest, or older if a retake is in progress)
          g.latestSubmitted = g.submitted.length > 0
            ? [...g.submitted].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0]
            : null;
        });
        const ps = (pcas || [])
          .map(a => a.papers)
          .filter(p => p && !p.archived)
          .map(p => {
            const g = byPaper[p.id] || { all: [], submitted: [], latest: null, latestSubmitted: null };
            return { ...p, latest: g.latest, latestSubmitted: g.latestSubmitted, submittedCount: g.submitted.length };
          });
        setAssignedPapers(ps);
        setPaperResponses(paperResps);
      } catch (e) { console.error("paper load failed", e); setPaperResponses([]); }

      const thisWeek = getWeekBounds(0);
      const thisWeekResps = resps.filter(r => { const d = new Date(r.answered_at); return d >= thisWeek.start && d <= thisWeek.end; });
      const validThisWeek = thisWeekResps.filter(r => !detectFakeAnswer(r.student_answer)).length;
      // Add this week's non-flagged paper responses — each counts as 1 unit toward the weekly target.
      const paperWeekCount = paperResps.filter(r => {
        const d = new Date(r.answered_at);
        return d >= thisWeek.start && d <= thisWeek.end;
      }).length;
      setWeeklyValid(validThisWeek + paperWeekCount);
      // Session target: how many questions to aim for in this session — remainder of weekly target, clamped 5-15
      const remaining = Math.max(0, WEEKLY_TARGET - (validThisWeek + paperWeekCount));
      setSessionTarget(Math.max(5, Math.min(15, remaining || 10)));

      const weeks = [];
      for (let w = 0; w < 8; w++) {
        const bounds = getWeekBounds(w);
        const weekResps = resps.filter(r => { const d = new Date(r.answered_at); return d >= bounds.start && d <= bounds.end; });
        const validRetrieval = weekResps.filter(r => !detectFakeAnswer(r.student_answer)).length;
        const correctRetrieval = weekResps.filter(r => r.is_correct && !detectFakeAnswer(r.student_answer)).length;
        const weekPaper = paperResps.filter(r => { const d = new Date(r.answered_at); return d >= bounds.start && d <= bounds.end; });
        const validPaper = weekPaper.length;
        const correctPaper = weekPaper.filter(r => (r.marks_awarded || 0) > 0).length;
        const valid = validRetrieval + validPaper;
        const correct = correctRetrieval + correctPaper;
        const overTarget = Math.max(0, valid - WEEKLY_TARGET);
        const stars = Math.floor(overTarget / STAR_INTERVAL);
        weeks.push({ weekStart: bounds.start, label: w === 0 ? "This week" : w === 1 ? "Last week" : `${w} weeks ago`, total: weekResps.length + weekPaper.length, valid, correct, stars, metTarget: valid >= WEEKLY_TARGET });
      }
      setWeeklyData(weeks);

      // 7-day habit — count valid responses per day, today on right
      const days = [];
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(today.getDate() - i); d.setHours(0,0,0,0);
        const end = new Date(d); end.setHours(23,59,59,999);
        const dayResps = resps.filter(r => { const rd = new Date(r.answered_at); return rd >= d && rd <= end; });
        const dayPaper = paperResps.filter(r => { const rd = new Date(r.answered_at); return rd >= d && rd <= end; });
        const count = dayResps.filter(r => !detectFakeAnswer(r.student_answer)).length + dayPaper.length;
        const label = i === 0 ? "Today" : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
        days.push({ date: d.toISOString(), label, count });
      }
      setHabitDays(days);

      // Identify recent mistakes for review mode — use most-recent response per question, keep the wrongs
      const latestByQ = {};
      resps.forEach(r => { if (!latestByQ[r.question_id]) latestByQ[r.question_id] = r; });
      const mistakes = new Set(Object.values(latestByQ).filter(r => !r.is_correct && !detectFakeAnswer(r.student_answer)).map(r => r.question_id));
      setMistakeQIds(mistakes);

      // Session starts at intro screen
      setSessionStarted(false);
      setReviewMode(false);
    } catch (e) { console.error(e); }
  };

  const submit = async () => {
    if (!ans.trim() || marking) return;
    stopMicIfActive();
    setMarking(true);
    const activeQs = reviewMode
      ? qs.filter(q => mistakeQIds.has(q.id))
      : (studyMode && studyTopicId ? qs.filter(q => q.topic_id === studyTopicId) : qs);
    const q = activeQs[qi];
    // One authoritative call: the edge function marks AND records the response
    // server-side, so the grade can't be forged client-side. It still returns a
    // verdict for the UI and queues itself if the network is down.
    const r = await sb.submitAnswer({ question: q.question_text, model_answer: q.model_answer, student_answer: ans, marks: q.marks, question_id: q.id, class_id: cls.id, student_id: user.id, skipFakeCheck: cls?.subjects?.marker_profile === "maths" });
    setRes(r);
    const prev = sr[q.id] || {};
    const nxt = nextSR(r.correct, prev);
    setSr(s => ({ ...s, [q.id]: nxt }));
    if (r.correct) setCorrectStreak(s => s + 1); else setCorrectStreak(0);
    // If wrong (and not a flagged low-effort attempt), put it on cooldown for the session
    if (!r.correct && !r.flagged) {
      setCooldown(prev => { const n = new Map(prev); n.set(q.id, COOLDOWN_LENGTH); return n; });
    }

    const isFlagged = r.flagged;
    if (!isFlagged) {
      const newValid = weeklyValid + 1;
      setWeeklyValid(newValid);
      // Track session
      const topicName = q.topics?.name || "Unknown";
      setSessionStats(prev => ({
        t: prev.t + 1,
        c: prev.c + (r.correct ? 1 : 0),
        topics: prev.topics.includes(topicName) ? prev.topics : [...prev.topics, topicName],
        struggles: !r.correct && !r.flagged
          ? [...prev.struggles, { question: q.question_text, studentAnswer: ans, modelAnswer: q.model_answer, topic: topicName }]
          : prev.struggles,
      }));
      // Star milestone
      const overTarget = newValid - WEEKLY_TARGET;
      if (overTarget > 0 && overTarget % STAR_INTERVAL === 0) {
        setStarPop(true);
        setTimeout(() => setStarPop(false), 2000);
      }
      // Show summary when target first hit this session
      if (newValid === WEEKLY_TARGET && !sessionHitTarget) {
        setSessionHitTarget(true);
        setTimeout(() => setShowSummary(true), 600); // brief delay so student sees the correct/wrong result
      }
    }

    // A queued (offline) answer has no row id yet, so flagging its mark is
    // unavailable until it syncs; everything else counts optimistically.
    if (r.response_id) setLastResponseId(r.response_id);
    setStats(s => ({ t: s.t + 1, c: s.c + (r.correct ? 1 : 0) }));
    setSessionQCount(n => n + 1);
    setMarking(false);
  };

  const next = () => {
    stopMicIfActive();
    // Use the functional setter so we read the FRESHEST cooldown map — the one
    // that includes whatever the most recent submit() just added. Without this,
    // the closure captures stale cooldown state and a wrong question can resurface
    // immediately because it never made it into the cooldownSet passed to sortQuestions.
    setCooldown(prevCooldown => {
      const nextCooldown = new Map();
      prevCooldown.forEach((remaining, qid) => { if (remaining > 1) nextCooldown.set(qid, remaining - 1); });
      // Re-sort the queue using the fresh cooldown set.
      setQs(prevQs => sortQuestions(prevQs, sr, recency, new Set(nextCooldown.keys())));
      return nextCooldown;
    });
    setQi(0); setAns(""); setRes(null);
    setFlagging(false); setFlagReason(""); setFlagMsg(""); setLastResponseId(null);
  };

  // Submit a marking flag (student reports wrong AI mark)
  const submitFlag = async () => {
    if (!lastResponseId) return;
    setFlagBusy(true); setFlagMsg("");
    try {
      const activeQs = reviewMode
        ? qs.filter(qq => mistakeQIds.has(qq.id))
        : (studyMode && studyTopicId ? qs.filter(qq => qq.topic_id === studyTopicId) : qs);
      const q = activeQs[qi];
      await sb.q("marking_flags", { method: "POST", body: {
        response_id: lastResponseId,
        student_id: user.id,
        class_id: cls.id,
        question_id: q.id,
        student_answer: ans,
        ai_feedback: res?.feedback || "",
        ai_correct: !!res?.correct,
        student_reason: flagReason.trim() || null,
      }});
      setFlagMsg("Thanks — your teacher will review this.");
      setFlagging(false); setFlagReason("");
    } catch (e) { setFlagMsg("Error: " + e.message); }
    setFlagBusy(false);
  };

  if (loading) return <div style={{ color: C.mid, padding: 40, textAlign: "center" }}>Loading...</div>;

  /* ── Class select + join ── */
  if (!cls) return (
    <div style={{ padding: 16, maxWidth: 500, margin: "0 auto" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, marginBottom: 16 }}>Your Classes</div>

      {/* Join a class */}
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ color: C.txt, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Join a class</div>
        <div style={{ color: C.dim, fontSize: 12, marginBottom: 10 }}>Enter the code your teacher gave you</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Inp placeholder="e.g. X7K3NP" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
            style={{ letterSpacing: 3, fontWeight: 700, fontSize: 18, textAlign: "center", textTransform: "uppercase" }}
            maxLength={6} onKeyDown={e => e.key === "Enter" && joinClass()} />
          <Btn onClick={joinClass} disabled={!joinCode.trim() || joining} style={{ whiteSpace: "nowrap" }}>{joining ? "..." : "Join"}</Btn>
        </div>
        {joinErr && <div style={{ color: C.red, fontSize: 13, marginTop: 8, padding: "8px 10px", background: C.redS, borderRadius: 8 }}>{joinErr}</div>}
      </Card>

      {/* Self-serve onboarding — only for a fresh, unaffiliated account */}
      {classes.length === 0 && !user?.profile?.school_id && (
        <Card style={{ padding: 16, marginBottom: 16, background: C.card2 }}>
          {!showStart ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 13, color: C.mid }}>A teacher setting up your school?</div>
              <Btn v="ghost" onClick={() => setShowStart(true)} style={{ fontSize: 12, whiteSpace: "nowrap" }}>Start a school</Btn>
            </div>
          ) : (
            <div>
              <div style={{ color: C.txt, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Set up your school</div>
              <div style={{ color: C.dim, fontSize: 12, marginBottom: 10 }}>You'll become the lead for a new free trial — then create classes and share join codes with pupils.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Inp placeholder="School name" value={schoolName} onChange={e => setSchoolName(e.target.value)} onKeyDown={e => e.key === "Enter" && startSchool()} />
                <Btn onClick={startSchool} disabled={!schoolName.trim() || creatingSchool} style={{ whiteSpace: "nowrap" }}>{creatingSchool ? "..." : "Create"}</Btn>
              </div>
              {createErr && <div style={{ color: C.red, fontSize: 13, marginTop: 8, padding: "8px 10px", background: C.redS, borderRadius: 8 }}>{createErr}</div>}
            </div>
          )}
        </Card>
      )}

      {classes.length === 0 ? (
        <Card style={{ padding: "32px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg></div>
          <div style={{ color: C.mid, fontSize: 14 }}>No classes yet</div>
          <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>Use a join code from your teacher above</div>
        </Card>
      ) : classes.map(c => (
        <Card key={c.id} onClick={() => pickClass(c)} style={{ padding: 16, marginBottom: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: C.txt, fontWeight: 600, fontSize: 15 }}>{c.name}</div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>{c.subjects?.name || "Science"}{c.year_group ? ` · Y${c.year_group}` : ""}</div>
          </div>
          <div style={{ color: C.pri, fontSize: 20 }}>›</div>
        </Card>
      ))}
    </div>
  );

  /* ── Quiz ── */
  const activeQs = reviewMode
    ? qs.filter(qq => mistakeQIds.has(qq.id))
    : (studyMode && studyTopicId ? qs.filter(qq => qq.topic_id === studyTopicId) : qs);
  const q = activeQs[qi];
  // Maths subjects get the working-friendly input (Enter = new line, symbol pad,
  // live preview). Keyed off the subject's marker_profile — the same field the
  // server resolves to pick the maths marking overlay, so input and marking agree.
  const isMaths = cls?.subjects?.marker_profile === "maths";
  // Derived session breakdown for the intro screen
  const introBreakdown = (() => {
    const upcoming = activeQs.slice(0, sessionTarget);
    let fresh = 0, review = 0;
    upcoming.forEach(uq => {
      const st = sr[uq.id];
      if (!st || !st.reps) fresh++; else review++;
    });
    return { fresh, review, total: upcoming.length };
  })();
  const estimatedMinutes = Math.max(1, Math.round(introBreakdown.total * 0.7));
  const acc = stats.t > 0 ? Math.round(stats.c / stats.t * 100) : 0;
  const isDue = !sr[q?.id] || !sr[q?.id]?.due || new Date(sr[q?.id].due) <= new Date();
  const weekPct = Math.min(100, Math.round((weeklyValid / WEEKLY_TARGET) * 100));
  const overTarget = Math.max(0, weeklyValid - WEEKLY_TARGET);
  const currentStars = Math.floor(overTarget / STAR_INTERVAL);
  // Topics available for study mode (derived from all questions)
  const studyTopics = [...new Map(qs.map(q => [q.topic_id, q.topics?.name || "Unknown"])).entries()]
    .map(([id, name]) => ({ id, name, count: qs.filter(qq => qq.topic_id === id).length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The pupil's own weak spots: their weakest *attempted* topics (topicStats is
  // already sorted weakest-first) that have a mapped revision resource. This is
  // the completion of the loop — their retrieval data → the spine → the matching
  // interactive-science tool/booklet — surfaced back to the learner, not just the teacher.
  const weakSpots = topicStats
    .filter(t => !t.isPlaceholder && t.t > 0 && t.topicId)
    .map(t => ({ ...t, pct: Math.round((t.c / t.t) * 100), resources: topicResources[t.topicId] || [], booklet: sb.bookletFor(t.topicId) }))
    .filter(t => t.pct < 70 && (t.resources.length > 0 || t.booklet))
    .slice(0, 4);

  // ── Paper-taking flow: when the student has tapped a paper, swap the entire
  // page to the paper attempt UI. The retrieval flow is paused; class context
  // is preserved so the back button returns them to where they were.
  if (paperBeingTaken && cls) {
    return <StudentPaperAttempt user={user} cls={cls}
      paperId={paperBeingTaken.id}
      forceNewAttempt={!!paperBeingTaken.retake}
      onExit={async () => {
        setPaperBeingTaken(null);
        // Refresh class data so the paper card shows updated submission status
        if (cls) await pickClass(cls);
      }} />;
  }

  return (
    <div style={{ padding: "12px 16px", maxWidth: 560, margin: "0 auto" }}>
      {/* Star pop animation */}
      {SHOW_GAMIFICATION && starPop && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, animation: "starPop 2s ease forwards", fontSize: 48, pointerEvents: "none" }}>⭐</div>
      )}

      {/* Dateline */}
      <Dateline left="Practice Journal" right={new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} style={{ marginBottom: 14 }} />

      {/* Back nav + class chip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8 }}>
        <button onClick={() => setCls(null)} style={{ background: "none", border: "none", color: C.mid, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>← All classes</button>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {SHOW_GAMIFICATION && correctStreak >= 3 && <Badge color={C.amb}>{correctStreak} in a row</Badge>}
          {SHOW_GAMIFICATION && currentStars > 0 && <Badge color={C.amb}>★ {currentStars}</Badge>}
          {sessionStats.t > 0 && <button onClick={() => setShowSummary(true)} style={{ background: "none", border: `1px solid ${C.bdr}`, borderRadius: 3, color: C.mid, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: "4px 8px" }}>Session · {sessionStats.t}</button>}
          <button onClick={() => { setStudyMode(p => !p); setStudyTopicId(null); setReviewMode(false); setRes(null); setAns(""); }} style={{ background: studyMode ? C.priSoftBg : "none", border: `1px solid ${studyMode ? C.pri : C.bdr}`, borderRadius: 3, color: studyMode ? C.pri : C.mid, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px", fontWeight: studyMode ? 600 : 500 }}>Study</button>
          {mistakeQIds.size > 0 && (
            <button onClick={() => {
                const turningOn = !reviewMode;
                setReviewMode(turningOn);
                setStudyMode(false); setStudyTopicId(null);
                setRes(null); setAns(""); setQi(0);
                if (turningOn) setSessionTarget(Math.min(10, mistakeQIds.size));
                else setSessionTarget(Math.max(5, Math.min(15, Math.max(0, WEEKLY_TARGET - weeklyValid) || 10)));
                setSessionStarted(false); setSessionQCount(0);
              }}
              style={{ background: reviewMode ? C.redSoft : "none", border: `1px solid ${reviewMode ? C.red : C.bdr}`, borderRadius: 3, color: reviewMode ? C.red : C.mid, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: "4px 10px", fontWeight: reviewMode ? 600 : 500 }}>
              Review ({mistakeQIds.size})
            </button>
          )}
          <Badge color={C.pri}>{cls.name}</Badge>
        </div>
      </div>

      {/* Editorial standfirst */}
      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.bdr}` }}>
        <Kicker>Today's session</Kicker>
        <Headline size={22} style={{ marginBottom: 6 }}>Welcome back.</Headline>
        <Deck>{weeklyValid >= WEEKLY_TARGET ? "You've hit this week's target. Anything more is gravy." : `${WEEKLY_TARGET - weeklyValid} question${WEEKLY_TARGET - weeklyValid === 1 ? "" : "s"} to reach this week's target of ${WEEKLY_TARGET}.`}</Deck>
      </div>

      {/* ── Your weak spots → revise them ──────────────────────────────────
           The pupil's own lowest topics, each linked to the matching
           interactive-science tool / widget / revision booklet. Only the weakest
           topics that actually have a mapped resource appear, so this stays a
           short, do-this-next list rather than a full report. */}
      {weakSpots.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 18, borderColor: "rgba(200,54,45,0.3)", background: C.priSoft }}>
          <Kicker>Your weak spots → revise them</Kicker>
          <Headline size={18} style={{ marginBottom: 4 }}>Target the gaps</Headline>
          <Deck style={{ marginBottom: 14 }}>Your lowest topics, each with a tool or booklet to revise it.</Deck>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {weakSpots.map((t, i) => (
              <div key={t.topicId} style={{ paddingBottom: i < weakSpots.length - 1 ? 12 : 0, borderBottom: i < weakSpots.length - 1 ? `1px solid ${C.bdrSoft}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: t.pct < 50 ? C.red : C.amb, flexShrink: 0 }}>{t.pct}%</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {t.resources.map(r => (
                    <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99, border: `1px solid ${C.pri}`, background: C.card, color: C.pri, fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: "inherit" }}>
                      <ResIcon kind={r.kind} color={C.pri} />
                      {r.title}
                      <span style={{ opacity: 0.55, fontWeight: 400 }}>↗</span>
                    </a>
                  ))}
                  {t.booklet && (
                    <a href={t.booklet.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99, border: `1px solid ${C.pri}`, background: C.priSoftBg, color: C.priDeep, fontSize: 12, fontWeight: 600, textDecoration: "none", fontFamily: "inherit" }}>
                      📖 Revision booklet
                      <span style={{ opacity: 0.55, fontWeight: 400 }}>↗</span>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Study mode topic picker */}
      {studyMode && (
        <Card style={{ padding: 14, marginBottom: 12, borderColor: "rgba(200,54,45,0.3)", background: C.priSoft }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.pri, marginBottom: 10 }}>
            Study mode — pick a topic. Answers still count toward your weekly target.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {studyTopics.map(t => (
              <button key={t.id} onClick={() => { setStudyTopicId(t.id); setQi(0); setRes(null); setAns(""); }}
                style={{ padding: "6px 12px", borderRadius: 99, border: `1px solid ${studyTopicId === t.id ? C.pri : C.bdr}`, background: studyTopicId === t.id ? C.pri : "transparent", color: studyTopicId === t.id ? "#fff" : C.mid, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: studyTopicId === t.id ? 600 : 400 }}>
                {t.name} <span style={{ opacity: 0.6 }}>({t.count})</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ── Streak + 7-day habit strip ────────────────────────────────────
           Banner up top shows the daily-practice streak with a flame whose intensity
           scales with streak length. The 7-day strip below shows the underlying
           activity. A milestone overlay fires once on hitting 3/7/14/30/50/100. */}
      {SHOW_GAMIFICATION && habitDays.length > 0 && (() => {
        const todayActive = habitDays[habitDays.length - 1].count > 0;
        let hasFreeze = false;
        try { hasFreeze = typeof window !== "undefined" && window.localStorage.getItem(freezeKey) === "1"; } catch {}
        // Determine what the next milestone is, for the "X days to go" hint
        const nextMilestone = STREAK_MILESTONES.find(m => m > dailyStreak);
        // Flame-intensity scales: 1-2 days dim; 3-6 small; 7-13 medium; 14-29 strong; 30+ large
        const flame = dailyStreak >= 30 ? "🔥🔥🔥" : dailyStreak >= 14 ? "🔥🔥" : dailyStreak >= 3 ? "🔥" : "";
        const streakColor = dailyStreak >= 30 ? C.acc : dailyStreak >= 7 ? C.amb : dailyStreak >= 3 ? C.amb : C.dim;

        return (
          <>
            {/* Streak banner */}
            <Card style={{ padding: "12px 14px", marginBottom: 10, background: dailyStreak >= 3 ? `linear-gradient(135deg, rgba(251,146,60,0.12), rgba(251,146,60,0.04))` : C.card, borderColor: dailyStreak >= 3 ? "rgba(251,146,60,0.3)" : C.bdr }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  fontSize: 28, lineHeight: 1,
                  filter: dailyStreak === 0 ? "grayscale(1)" : "none",
                  opacity: dailyStreak === 0 ? 0.4 : 1,
                  transform: streakBumped ? "scale(1.3)" : "scale(1)",
                  transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}>{flame || "🕯️"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: streakColor, lineHeight: 1 }}>
                      {dailyStreak}
                    </span>
                    <span style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>day{dailyStreak === 1 ? "" : "s"} in a row</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
                    {dailyStreak === 0 ? "Practise today to start a streak" :
                     !todayActive ? "Practise today to keep it alive!" :
                     nextMilestone ? `${nextMilestone - dailyStreak} more day${nextMilestone - dailyStreak === 1 ? "" : "s"} to ${nextMilestone}` :
                     "Legendary streak. Keep going."}
                  </div>
                </div>
                {hasFreeze && (
                  <div title="You have a streak freeze — one missed day won't break your streak." style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(200,54,45,0.10)", border: "1px solid rgba(200,54,45,0.3)", color: C.acc, fontWeight: 600, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    ❄️ Freeze
                  </div>
                )}
              </div>
            </Card>

            {/* 7-day habit strip */}
            <Card style={{ padding: "10px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Last 7 days</div>
                <div style={{ fontSize: 10, color: C.dim }}>{habitDays.filter(d => d.count > 0).length} of 7 active</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {habitDays.map((d, i) => {
                  const isToday = i === habitDays.length - 1;
                  let col = C.bdr;
                  if (d.count >= 10) col = C.grn;
                  else if (d.count >= 5) col = C.amb;
                  else if (d.count > 0) col = C.red;
                  const empty = d.count === 0;
                  return (
                    <div key={i} style={{ flex: 1, textAlign: "center" }}>
                      <div title={`${d.label}: ${d.count} answered`} style={{
                        height: 28, background: col, borderRadius: 6,
                        border: isToday ? `2px solid ${C.pri}` : "none",
                        opacity: empty && !isToday ? 0.35 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, color: d.count > 0 ? "#fff" : C.dim, fontWeight: 700,
                        animation: isToday && empty ? "pulseToday 2s ease-in-out infinite" : "none",
                      }}>
                        {d.count > 0 ? d.count : (isToday ? "·" : "")}
                      </div>
                      <div style={{ fontSize: 9, color: isToday ? C.pri : C.dim, marginTop: 3, fontWeight: isToday ? 700 : 500 }}>{d.label.slice(0, 3)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Milestone celebration overlay — fires once when you cross 3/7/14/30/50/100. */}
            {milestone && (
              <div onClick={() => setMilestone(null)}
                style={{ position: "fixed", inset: 0, background: "rgba(26,29,58,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, animation: "fadeIn 0.25s ease", cursor: "pointer" }}>
                <div onClick={e => e.stopPropagation()} style={{
                  background: C.card, border: `1px solid ${C.bdr}`,
                  borderRadius: 16, padding: "32px 28px", maxWidth: 320, textAlign: "center",
                  boxShadow: "0 20px 60px rgba(26,29,58,0.18)",
                  animation: "milestonePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}>
                  <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>
                    {milestone.n >= 100 ? "🏆" : milestone.n >= 30 ? "💎" : milestone.n >= 14 ? "🌟" : milestone.n >= 7 ? "🔥" : "✨"}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: C.txt, marginBottom: 4 }}>
                    {milestone.n}-day streak!
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, marginBottom: 18, lineHeight: 1.5 }}>
                    {milestone.n === 3 ? "You've started a habit. Keep it going." :
                     milestone.n === 7 ? "A whole week. You've earned a streak freeze ❄️ — one missed day will be forgiven." :
                     milestone.n === 14 ? "Two weeks straight. Properly impressive." :
                     milestone.n === 30 ? "A whole month. You're in the top few percent." :
                     milestone.n === 50 ? "50 days. Genuinely outstanding." :
                     milestone.n === 100 ? "100 days. You're a legend." :
                     `${milestone.n} days. Extraordinary.`}
                  </div>
                  <button onClick={() => setMilestone(null)} style={{ padding: "10px 24px", background: C.pri, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    Keep going
                  </button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Weekly target progress */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Weekly target</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: weeklyValid >= WEEKLY_TARGET ? C.grn : weeklyValid >= WEEKLY_TARGET * 0.5 ? C.amb : C.red }}>{weeklyValid}/{WEEKLY_TARGET}</span>
            <button onClick={() => setShowWeeks(!showWeeks)} style={{ background: "none", border: "none", color: C.dim, fontSize: 11, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
              {showWeeks ? "Hide" : "History"}
            </button>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ width: "100%", height: 10, background: C.bdr, borderRadius: 99, overflow: "hidden", position: "relative" }}>
          <div style={{ width: `${weekPct}%`, height: "100%", background: weeklyValid >= WEEKLY_TARGET ? C.grn : weeklyValid >= WEEKLY_TARGET * 0.5 ? C.amb : C.red, borderRadius: 99, transition: "width .4s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 10, color: C.dim }}>{weeklyValid < WEEKLY_TARGET ? `${WEEKLY_TARGET - weeklyValid} to go` : "Target hit"}</span>
          {SHOW_GAMIFICATION && overTarget > 0 && <span style={{ fontSize: 10, color: C.amb }}>Next ⭐ in {STAR_INTERVAL - (overTarget % STAR_INTERVAL)} questions</span>}
        </div>
        {sessionQCount > 0 && (
          <button onClick={() => setShowSummary(true)} style={{ marginTop: 10, width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
            Finish session — see summary ({sessionQCount} answered)
          </button>
        )}

        {/* Star progress if over target */}
        {SHOW_GAMIFICATION && currentStars > 0 && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: C.ambS, borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16 }}>{"⭐".repeat(Math.min(currentStars, 5))}{currentStars > 5 ? ` +${currentStars - 5}` : ""}</span>
            <span style={{ fontSize: 11, color: C.amb, fontWeight: 600 }}>{currentStars} achievement point{currentStars !== 1 ? "s" : ""} this week!</span>
          </div>
        )}
      </div>

      {/* Previous weeks */}
      {showWeeks && (
        <Card style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 10 }}>Previous weeks</div>
          {weeklyData.filter((_, i) => i > 0).map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: i < weeklyData.length - 2 ? `1px solid ${C.bdr}` : "none" }}>
              <div style={{ flex: 1, fontSize: 12, color: C.mid }}>{w.label}</div>
              <div style={{ width: 80 }}>
                <div style={{ width: "100%", height: 4, background: C.bdr, borderRadius: 99 }}>
                  <div style={{ width: `${Math.min(100, (w.valid / WEEKLY_TARGET) * 100)}%`, height: "100%", background: w.metTarget ? C.grn : C.red, borderRadius: 99 }} />
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: w.metTarget ? C.grn : C.red, minWidth: 35, textAlign: "right" }}>{w.valid}/{WEEKLY_TARGET}</span>
              {SHOW_GAMIFICATION && w.stars > 0 && <span style={{ fontSize: 12 }}>{"⭐".repeat(Math.min(w.stars, 3))}{w.stars > 3 ? `+${w.stars-3}` : ""}</span>}
              {!w.metTarget && w.valid > 0 && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, display: "inline-block" }} />}
            </div>
          ))}
        </Card>
      )}

      {/* ── Assigned papers ── (Option B: just below the weekly target, before stats)
           Compact card listing exam-style papers the teacher has assigned to this class.
           Tapping a paper enters paper-attempt mode (full take). Hidden if no papers. */}
      {assignedPapers.length > 0 && (
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>Papers from your teacher</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {assignedPapers.map(p => {
              const inProgress = p.latest && !p.latest.submitted_at;
              const submitted = !inProgress && p.latestSubmitted;
              const pct = submitted ? Math.round(((p.latestSubmitted.awarded_marks ?? 0) / Math.max(1, p.latestSubmitted.total_marks ?? p.total_marks)) * 100) : 0;
              const meta = [p.exam_board, p.paper_year, p.paper_number].filter(Boolean).join(" · ");
              const onRowClick = () => {
                if (inProgress) setPaperBeingTaken({ id: p.id });
                else if (submitted) setPaperBeingTaken({ id: p.id, retake: true });
                else setPaperBeingTaken({ id: p.id });
              };
              return (
                <div key={p.id} onClick={onRowClick}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: submitted && !inProgress ? C.card2 : C.priSoft, border: `1px solid ${submitted && !inProgress ? C.bdr : C.pri + "40"}`, cursor: "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                      {[meta, `${p.total_marks} marks`, p.submittedCount > 1 ? `${p.submittedCount} attempts` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {submitted && !inProgress && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red }}>{p.latestSubmitted.awarded_marks}/{p.latestSubmitted.total_marks}</div>
                      <div style={{ fontSize: 10, color: C.dim }}>Last score</div>
                    </div>
                  )}
                  {inProgress ? (
                    <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: C.amb, color: "#fff", fontWeight: 600 }}>Resume →</div>
                  ) : submitted ? (
                    <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: C.pri, color: "#fff", fontWeight: 600 }}>Retake →</div>
                  ) : (
                    <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: C.pri, color: "#fff", fontWeight: 600 }}>Start →</div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(() => {
        const tw = weeklyData[0];
        const isWeek = statView === "thisWeek";
        const t = isWeek ? (tw?.total || 0) : stats.t;
        const c = isWeek ? (tw?.correct || 0) : stats.c;
        const pct = t > 0 ? Math.round(c / t * 100) : 0;
        return (
          <div style={{ marginBottom: 18, paddingTop: 16, borderTop: `1px solid ${C.bdr}` }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, justifyContent: "flex-end" }}>
              <Pill on={statView === "allTime"} onClick={() => setStatView("allTime")} style={{ fontSize: 11, padding: "4px 10px" }}>All time</Pill>
              <Pill on={statView === "thisWeek"} onClick={() => setStatView("thisWeek")} style={{ fontSize: 11, padding: "4px 10px" }}>This week</Pill>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${C.bdr}`, borderBottom: `1px solid ${C.bdr}` }}>
              {[
                { n: t, l: "Done", col: C.txt },
                { n: c, l: "Correct", col: C.grn },
                { n: `${pct}%`, l: "Accuracy", col: t > 0 ? (pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red) : C.dim },
              ].map((m, i) => (
                <div key={m.l} style={{ padding: "14px 0", paddingLeft: i ? 16 : 0, borderLeft: i ? `1px solid ${C.bdr}` : "none" }}>
                  <div style={{ fontFamily: C.serif, fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: m.col, fontVariantNumeric: "tabular-nums" }}>{m.n}</div>
                  <div style={{ marginTop: 6, fontSize: 9.5, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: C.dim }}>{m.l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Topic strength */}
      {topicStats.length > 0 && (
        <div style={{ marginBottom: 18, borderTop: `1px solid ${C.bdr}`, borderBottom: showTopics ? "none" : `1px solid ${C.bdr}` }}>
          <button onClick={() => setShowTopics(p => !p)} style={{ width: "100%", background: "none", border: "none", outline: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Topic strength</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {!showTopics && (() => {
                const attempted = topicStats.filter(t => !t.isPlaceholder);
                const weak = attempted.filter(t => t.t > 0 && Math.round(t.c / t.t * 100) < 50);
                return weak.length > 0
                  ? <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>{weak.length} weak area{weak.length !== 1 ? "s" : ""}</span>
                  : <span style={{ fontSize: 11, color: C.grn, fontWeight: 600 }}>Looking good</span>;
              })()}
              <span style={{ color: C.dim, fontSize: 12, transition: "transform .2s", display: "inline-block", transform: showTopics ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
            </div>
          </button>

          {showTopics && (
            <div style={{ marginTop: 4, paddingBottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {topicStats.map((t, i) => {
                if (t.isPlaceholder) return (
                  <div key="placeholder" style={{ padding: "8px 10px", borderRadius: 8, background: C.card2, fontSize: 12, color: C.dim, textAlign: "center" }}>{t.name}</div>
                );
                const pct = t.t > 0 ? Math.round(t.c / t.t * 100) : 0;
                const col = pct >= 70 ? C.grn : pct >= 50 ? C.amb : C.red;
                const label = pct >= 70 ? "Strong" : pct >= 50 ? "Getting there" : "Needs work";
                return (
                  <div key={i} style={{ padding: "9px 10px", borderRadius: 8, background: C.card2, borderLeft: `3px solid ${col}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: C.txt, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{t.name}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: C.dim }}>{t.t} answered</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: C.bdr, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 99, transition: "width .4s" }} />
                      </div>
                      <span style={{ fontSize: 10, color: col, fontWeight: 600, minWidth: 72, textAlign: "right" }}>{label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeQs.length === 0 && studyMode ? (
        <Card style={{ padding: "36px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}>{studyTopicId
            ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.grn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
            : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11V7a5 5 0 0 1 10 0v4" /><path d="m12 12 0 7M9 16l3 3 3-3" /></svg>}</div>
          <div style={{ color: C.mid, fontSize: 14, fontWeight: 600 }}>
            {studyTopicId ? "All caught up on this topic" : "Pick a topic above to start studying"}
          </div>
          {studyTopicId && <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>All questions in this topic are mastered or not yet due</div>}
        </Card>
      ) : qs.length === 0 ? (
        <Card style={{ padding: "48px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg></div>
          <div style={{ color: C.mid }}>No questions available yet</div>
          <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>Your teacher hasn't unlocked any topics</div>
        </Card>
      ) : showSummary ? (
        /* ── Session summary ── */
        <Card style={{ padding: 24, textAlign: "center" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>{weeklyValid >= WEEKLY_TARGET
            ? <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={C.grn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>
            : <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={C.acc} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="13" y="7" width="3" height="10" /></svg>}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.txt, letterSpacing: -0.5, marginBottom: 4 }}>
            {weeklyValid >= WEEKLY_TARGET ? "Target hit!" : "Session complete"}
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginBottom: 24 }}>
            {weeklyValid >= WEEKLY_TARGET ? `${weeklyValid}/${WEEKLY_TARGET} questions done this week` : `${weeklyValid}/${WEEKLY_TARGET} questions done this week — keep going!`}
          </div>

          {/* Session stats */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <div style={{ flex: 1, padding: "14px 10px", borderRadius: 12, background: C.card2 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.acc }}>{sessionStats.t}</div>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>This session</div>
            </div>
            <div style={{ flex: 1, padding: "14px 10px", borderRadius: 12, background: C.card2 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.grn }}>{sessionStats.c}</div>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>Correct</div>
            </div>
            <div style={{ flex: 1, padding: "14px 10px", borderRadius: 12, background: C.card2 }}>
              {(() => { const p = sessionStats.t > 0 ? Math.round(sessionStats.c / sessionStats.t * 100) : 0; return <>
                <div style={{ fontSize: 26, fontWeight: 800, color: p >= 70 ? C.grn : p >= 50 ? C.amb : C.red }}>{p}%</div>
                <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>Accuracy</div>
              </>; })()}
            </div>
          </div>

          {/* Topics covered */}
          {sessionStats.topics.length > 0 && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: C.card2, textAlign: "left" }}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Topics covered</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {sessionStats.topics.map((t, i) => (
                  <span key={i} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 99, background: C.priSoft, color: C.pri, fontWeight: 500 }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {sessionStats.struggles.length > 0 && (
            <div style={{ marginBottom: 20, textAlign: "left" }}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                Questions to revisit ({sessionStats.struggles.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sessionStats.struggles.map((s, i) => (
                  <div key={i} style={{ borderRadius: 10, border: `1px solid rgba(239,68,68,0.2)`, overflow: "hidden" }}>
                    <div style={{ padding: "10px 12px", background: C.redS }}>
                      <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>{s.topic}</div>
                      <div style={{ fontSize: 13, color: C.txt, fontWeight: 500, lineHeight: 1.4 }}>{s.question}</div>
                    </div>
                    <div style={{ padding: "8px 12px", background: C.card2 }}>
                      <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>You wrote</div>
                      <div style={{ fontSize: 12, color: C.mid, marginBottom: 8, fontStyle: "italic" }}>"{s.studentAnswer}"</div>
                      <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Correct answer</div>
                      <div style={{ fontSize: 12, color: C.grn, fontWeight: 500, lineHeight: 1.4 }}>{s.modelAnswer}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {weeklyValid < WEEKLY_TARGET && (
              <Btn onClick={() => setShowSummary(false)} style={{ width: "100%", padding: "14px 20px" }}>
                Keep going →
              </Btn>
            )}
            {weeklyValid >= WEEKLY_TARGET && (
              <Btn onClick={() => setShowSummary(false)} style={{ width: "100%", padding: "14px 20px" }}>
                Keep going — every extra question counts
              </Btn>
            )}
            <Btn v="ghost" onClick={() => setCls(null)} style={{ width: "100%", fontSize: 13 }}>
              Back to classes
            </Btn>
          </div>
        </Card>
      ) : reviewMode && activeQs.length === 0 ? (
        <Card style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.grn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg></div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 4 }}>No mistakes to review</div>
          <div style={{ fontSize: 13, color: C.mid, marginBottom: 20 }}>You're up to date. Back to normal practice?</div>
          <Btn onClick={() => { setReviewMode(false); setSessionStarted(false); }} style={{ width: "100%" }}>← Back to practice</Btn>
        </Card>
      ) : !sessionStarted ? (
        /* ── Session intro ── */
        <Card style={{ padding: "24px 20px", textAlign: "center" }}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}>{reviewMode
            ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
            : studyMode
            ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.pri} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
            : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.pri} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></svg>}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, letterSpacing: -0.3, marginBottom: 4 }}>
            {reviewMode ? "Review your mistakes" : studyMode ? "Study mode" : "Ready to practise?"}
          </div>
          <div style={{ fontSize: 13, color: C.mid, marginBottom: 18 }}>
            {reviewMode ? `${mistakeQIds.size} question${mistakeQIds.size === 1 ? "" : "s"} you recently got wrong` :
             studyMode && !studyTopicId ? "Pick a topic above to begin" :
             weeklyValid >= WEEKLY_TARGET ? `You've already hit this week's target — anything more is a bonus` :
             `${Math.max(0, WEEKLY_TARGET - weeklyValid)} to go this week`}
          </div>

          {activeQs.length > 0 && (!studyMode || studyTopicId) && (
            <>
              {/* Session breakdown */}
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <div style={{ flex: 1, padding: "12px 10px", borderRadius: 10, background: C.card2 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.pri }}>{introBreakdown.total}</div>
                  <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>Questions</div>
                </div>
                {!reviewMode && (
                  <>
                    <div style={{ flex: 1, padding: "12px 10px", borderRadius: 10, background: C.card2 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: C.acc }}>{introBreakdown.fresh}</div>
                      <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>New</div>
                    </div>
                    <div style={{ flex: 1, padding: "12px 10px", borderRadius: 10, background: C.card2 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: C.amb }}>{introBreakdown.review}</div>
                      <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>Review</div>
                    </div>
                  </>
                )}
                <div style={{ flex: 1, padding: "12px 10px", borderRadius: 10, background: C.card2 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.mid }}>~{estimatedMinutes}</div>
                  <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>Min</div>
                </div>
              </div>

              <Btn onClick={() => setSessionStarted(true)} style={{ width: "100%", padding: "14px 20px" }}>
                {reviewMode ? "Start review →" : "Start session →"}
              </Btn>
              {!reviewMode && (
                <div style={{ fontSize: 11, color: C.dim, marginTop: 10 }}>You can finish early whenever you want</div>
              )}
            </>
          )}
        </Card>
      ) : (
        <Card style={{ overflow: "hidden" }}>
          {(() => {
            const srData = sr[q?.id];
            const srInfo = getSRInfo(srData, isDue);
            const sessionPct = Math.min(100, Math.round((sessionQCount / sessionTarget) * 100));
            return (
              <>
                <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Badge color={C.acc}>{q?.topics?.name}</Badge>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: srInfo.color, padding: "2px 8px", borderRadius: 99, background: `${srInfo.color}18` }}>{srInfo.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{srInfo.detail}</div>
                    </div>
                    <span style={{ fontSize: 12, color: C.dim }}>{q?.marks}mk</span>
                  </div>
                </div>
                {/* Session progress */}
                <div style={{ padding: "0 16px 10px", borderBottom: `1px solid ${C.bdr}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Session · Q{Math.min(sessionQCount + 1, sessionTarget)} of {sessionTarget}
                    </span>
                    <span style={{ fontSize: 10, color: C.dim }}>{sessionPct}%</span>
                  </div>
                  <div style={{ width: "100%", height: 4, background: C.bdr, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${sessionPct}%`, height: "100%", background: sessionPct >= 100 ? C.grn : C.pri, borderRadius: 99, transition: "width .3s ease" }} />
                  </div>
                </div>
              </>
            );
          })()}
          <div style={{ padding: "20px 16px" }}>
            {q?.image_url && (
              <div style={{ marginBottom: 14, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.bdr}`, background: "#fff" }}>
                <img src={q.image_url} alt="question diagram" style={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block" }} />
              </div>
            )}
            <div style={{ fontSize: 16, color: C.txt, lineHeight: 1.55, marginBottom: 20, fontWeight: 500 }}>{q?.question_text}</div>
            {!res ? (
              <>
                {isMaths ? (
                  // Maths: working-friendly input. Enter makes a new line, a symbol
                  // pad + ⌘. insert powers/roots/etc., and a live preview shows x².
                  // No mic — equations aren't dictated. Submit is button-only below.
                  <MathInput value={ans} onChange={setAns} rows={4} disabled={marking} />
                ) : (
                  <>
                    <div style={{ position: "relative" }}>
                      <TA value={ans} onChange={e => setAns(e.target.value)} placeholder={isRecording ? "Listening… speak naturally" : "Type your answer… or tap the mic"} rows={3} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} style={{ paddingRight: speechSupported ? 52 : undefined }} />
                      {speechSupported && (
                        <button type="button" onClick={toggleMic} aria-label={isRecording ? "Stop recording" : "Start voice input"}
                          style={{ position: "absolute", right: 10, bottom: 10, width: 36, height: 36, borderRadius: 99, border: `1px solid ${isRecording ? C.red : C.bdr}`, background: isRecording ? C.red : C.card, color: isRecording ? "#fff" : C.mid, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, padding: 0, boxShadow: isRecording ? `0 0 0 4px ${C.redS}` : "none", transition: "all .15s ease" }}>
                          {isRecording
                            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.mid} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 19v3" /></svg>}
                        </button>
                      )}
                    </div>
                    {isRecording && <div style={{ fontSize: 11, color: C.red, marginTop: 6, textAlign: "center", fontWeight: 500 }}>● Recording — tap mic again to stop</div>}
                    {speechError && <div style={{ fontSize: 11, color: C.red, marginTop: 6, textAlign: "center" }}>{speechError}</div>}
                  </>
                )}
                <Btn onClick={submit} disabled={!ans.trim() || marking} style={{ width: "100%", marginTop: 12, padding: "14px 20px" }}>{marking ? "Marking..." : "Submit"}</Btn>
              </>
            ) : (
              <div style={{ animation: "slideUp .25s ease" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: 12, background: res.correct ? C.grnS : C.redS, border: `1px solid ${res.correct ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)"}`, marginBottom: 14 }}>
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{res.correct ? "✓" : "✗"}</span>
                  <div>
                    <div style={{ color: res.correct ? C.grn : C.red, fontWeight: 700, fontSize: 15 }}>{res.correct ? "Correct!" : "Not quite"} <span style={{ fontWeight: 400, opacity: .7 }}>({res.marks_awarded}/{q.marks})</span></div>
                    <div style={{ color: C.mid, fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>{res.feedback}</div>
                  </div>
                </div>
                <div style={{ padding: "10px 14px", background: `${C.bdr}44`, borderRadius: 10, marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: .4 }}>You wrote</span>
                  <div style={{ color: C.mid, marginTop: 3 }}>{ans}</div>
                </div>
                <div style={{ padding: "10px 14px", background: C.priSoft, borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                  <span style={{ color: C.dim, fontSize: 10, textTransform: "uppercase", letterSpacing: .4 }}>Model answer</span>
                  <div style={{ color: C.txt, marginTop: 3 }}>{q.model_answer}</div>
                </div>
                <Btn onClick={next} style={{ width: "100%", padding: "14px 20px" }}>Next question →</Btn>
                {flagMsg ? (
                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: flagMsg.startsWith("Error") ? C.redS : C.grnS, color: flagMsg.startsWith("Error") ? C.red : C.grn, fontSize: 12, textAlign: "center" }}>{flagMsg}</div>
                ) : !flagging ? (
                  <button onClick={() => { setFlagging(true); setFlagReason(""); }} style={{ marginTop: 10, width: "100%", background: "transparent", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 4 }}>
                    Something wrong with this mark? Tell your teacher
                  </button>
                ) : (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: C.card2, border: `1px solid ${C.bdr}` }}>
                    <div style={{ fontSize: 12, color: C.mid, marginBottom: 6, fontWeight: 600 }}>Report wrong marking</div>
                    <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Your teacher will review this. Your mark won't change automatically.</div>
                    <TA value={flagReason} onChange={e => setFlagReason(e.target.value)} rows={2} maxLength={300} placeholder="What's wrong? (optional)" style={{ fontSize: 13 }} />
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <Btn onClick={submitFlag} disabled={flagBusy} style={{ flex: 1, fontSize: 12, padding: "8px 12px" }}>{flagBusy ? "..." : "Send"}</Btn>
                      <Btn v="ghost" onClick={() => { setFlagging(false); setFlagReason(""); }} disabled={flagBusy} style={{ fontSize: 12, padding: "8px 12px" }}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─── ADMIN PANEL (moderator only) ─── */
