"use client";
import { useState, useEffect } from "react";
import { sb } from "../lib/supabase";
import { C } from "../lib/theme";
import { isHoD, isModerator } from "../lib/roles";
import { planAllows } from "../lib/plans";
import { STAR_INTERVAL, WEEKLY_TARGET, getWeekBounds } from "../lib/week";
import { AdminPanel } from "./AdminPanel";
import { BulkUpload } from "./BulkUpload";
import { ClassGaps } from "./ClassGaps";
import { Misconceptions } from "./Misconceptions";
import { HodPanel } from "./HodPanel";
import { MarkReview } from "./MarkReview";
import { LessonStarter } from "./LessonStarter";
import { PaperManager } from "./PaperManager";
import { QMgr } from "./QMgr";
import { RequestCore } from "./RequestCore";
import { Student } from "./Student";
import { StudentList } from "./StudentList";
import { StudentPaperAttempt } from "./StudentPaperAttempt";
import { TopicSelector } from "./TopicSelector";
import { Badge, Bar, Btn, Card, Dateline, Deck, Headline, Inp, Kicker, Pill, Section, TA } from "./ui";

export function Teacher({ user }) {
  const isMod = isModerator(user);
  // Strict HoD: only an actual Head of Department gets the (self-scoped)
  // department view. Moderators have the Admin panel instead — previously they
  // were treated as HoDs and landed on an empty department tab.
  const showDept = isHoD(user);
  const [tab, setTab] = useState(showDept ? "hod" : "dashboard");
  const [classes, setClasses] = useState([]);
  const [cls, setCls] = useState(null);
  const [topics, setTopics] = useState([]);
  const [unlocked, setUnlocked] = useState(new Set());
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(null);
  const [schools, setSchools] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [sId, setSId] = useState(null);
  const [subId, setSubId] = useState(null);
  const [fv, setFv] = useState("");
  const [cf, setCf] = useState({ n: "", y: "" });
  const [timePeriod, setTimePeriod] = useState("thisWeek");
  const [targetDraft, setTargetDraft] = useState(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingRecency, setSavingRecency] = useState(false);
  const [deliveries, setDeliveries] = useState({}); // topicId → {taught_at, notes}
  const [parentTokens, setParentTokens] = useState({}); // studentId → token UUID
  const [rawResps, setRawResps] = useState([]); // full response rows for the active class — used by CSV export
  const [expandedQuestionStat, setExpandedQuestionStat] = useState(null); // question_id with wrong answers panel open
  const [topicBank, setTopicBank] = useState({}); // topic_id → count of non-archived questions (coverage denominator)
  const [expandedSpread, setExpandedSpread] = useState(null); // topic_id with per-student spread panel open
  // Marking flag review state
  const [expandedFlag, setExpandedFlag] = useState(null); // flag_id being reviewed
  const [flagNote, setFlagNote] = useState(""); // teacher's optional note on the active review
  const [flagBusy, setFlagBusy] = useState(null); // flag_id currently being saved
  // Onboarding panel: persists dismissal in localStorage so it never re-shows once closed.
  // Keyed per-user so a different teacher on the same browser sees their own state.
  const onboardingKey = `onboarding_dismissed_${user.id}`;
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(onboardingKey) === "1"; } catch { return false; }
  });
  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    try { window.localStorage.setItem(onboardingKey, "1"); } catch {}
  };

  // Resolve a marking flag. If overturned, also updates the underlying response row.
  const resolveFlag = async (flag, decision, note) => {
    if (!cls || flagBusy) return;
    setFlagBusy(flag.id);
    try {
      if (decision === "overturned" && flag.response_id) {
        // Update the original response: mark it correct and award full marks.
        // Prepend [OVERTURNED] to feedback so it's visible to the student.
        const maxMarks = flag.questions?.marks ?? 1;
        const prevFeedback = flag.ai_feedback || "";
        const newFeedback = `[OVERTURNED by teacher] ${prevFeedback}`.slice(0, 2000);
        await sb.q("responses", {
          method: "PATCH",
          params: { id: `eq.${flag.response_id}` },
          body: { is_correct: true, marks_awarded: maxMarks, ai_feedback: newFeedback },
        });
      }
      await sb.q("marking_flags", {
        method: "PATCH",
        params: { id: `eq.${flag.id}` },
        body: {
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          teacher_decision: decision,
          teacher_notes: (note || "").trim() || null,
        },
      });
      setExpandedFlag(null);
      setFlagNote("");
      if (cls) await loadCls(cls);
    } catch (e) {
      console.error("resolveFlag failed", e);
      alert("Could not save: " + e.message);
    }
    setFlagBusy(null);
  };

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const [c, sc, su] = await Promise.all([
        sb.q("classes", { params: { teacher_id: `eq.${user.id}`, select: "*,subjects(name)" } }),
        sb.q("schools", {}), sb.q("subjects", {}),
      ]);
      setClasses(c); setSchools(sc); setSubjects(su);
      if (c.length) { setCls(c[0]); await loadCls(c[0]); }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadCls = async (c) => {
    // Declared at function top so dashboard fold-in below always has it in scope, even if the
    // paper-fetch block fails. Fixes ReferenceError that blanked the dashboard.
    let classPaperResps = [];
    try {
      const [allT, ul, resps, mems, dels, tokens] = await Promise.all([
        sb.q("topics", { params: { subject_id: `eq.${c.subject_id}`, select: "*", order: "sort_order.asc" } }),
        sb.q("class_topics", { params: { class_id: `eq.${c.id}`, select: "topic_id,recency_rank" } }),
        sb.q("responses", { params: { class_id: `eq.${c.id}`, select: "*,questions(question_text,model_answer,topic_id,topics(name)),profiles(display_name)" } }),
        sb.q("class_members", { params: { class_id: `eq.${c.id}`, select: "*,profiles(display_name,email)" } }),
        sb.q("lesson_deliveries", { params: { class_id: `eq.${c.id}`, select: "topic_id,taught_at,notes" } }),
        sb.q("parent_tokens", { params: { class_id: `eq.${c.id}`, select: "student_id,token" } }),
      ]);
      setTopics(allT); setUnlocked(new Set(ul.map(t => t.topic_id)));
      setRawResps(resps || []);
      // Bank size per topic — count of non-archived questions (incl. never-attempted),
      // used as the coverage denominator in the Question spread panel. One light query, runs on class load.
      try {
        const tids = allT.map(t => t.id);
        if (tids.length) {
          const bankQs = await sb.q("questions", { params: { topic_id: `in.(${tids.join(",")})`, archived: "eq.false", select: "id,topic_id" } });
          const bank = {}; (bankQs || []).forEach(q => { bank[q.topic_id] = (bank[q.topic_id] || 0) + 1; });
          setTopicBank(bank);
        } else { setTopicBank({}); }
      } catch (e) { console.error("bank size fetch failed", e); setTopicBank({}); }
      const delMap = {}; dels.forEach(d => { delMap[d.topic_id] = { taught_at: d.taught_at, notes: d.notes }; });
      setDeliveries(delMap);
      const tokMap = {}; tokens.forEach(t => { tokMap[t.student_id] = t.token; });
      setParentTokens(tokMap);

      const clsTarget = c.weekly_target ?? WEEKLY_TARGET;
      const sm = {};
      mems.forEach(m => {
        sm[m.student_id] = { name: m.profiles?.display_name || "?", email: m.profiles?.email || "", t: 0, c: 0, weekValid: 0, weekStars: 0, flagged: 0, targetOverride: m.weekly_target_override ?? null };
      });
      const mis = {}, tp = {};
      const thisWeekBounds = getWeekBounds(0);
      const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      // Pre-calculate 12 week boundaries for history
      const weekBounds = Array.from({ length: 12 }, (_, i) => getWeekBounds(i));

      resps.forEach(r => {
        if (sm[r.student_id]) {
          sm[r.student_id].t++;
          if (r.is_correct) sm[r.student_id].c++;
          const isFlagged = r.ai_feedback && r.ai_feedback.startsWith("FLAGGED:");
          if (isFlagged) sm[r.student_id].flagged++;
          const d = new Date(r.answered_at);
          if (d >= thisWeekBounds.start && d <= thisWeekBounds.end && !isFlagged) {
            sm[r.student_id].weekValid++;
          }
        }
        if (!r.is_correct && r.questions && new Date(r.answered_at) >= twoWeeksAgo) {
          const k = r.questions.question_text;
          if (!mis[k]) mis[k] = { q: k, topic: r.questions.topics?.name || "", n: 0, ans: [] };
          mis[k].n++; if (mis[k].ans.length < 3) mis[k].ans.push(r.student_answer);
        }
        if (r.questions?.topics?.name) {
          const t = r.questions.topics.name;
          if (!tp[t]) tp[t] = { t: 0, c: 0 }; tp[t].t++; if (r.is_correct) tp[t].c++;
        }
      });

      // Build per-student 12-week history
      Object.keys(sm).forEach(sid => {
        const sResps = resps.filter(r => r.student_id === sid);
        sm[sid].weeklyHistory = weekBounds.map((wb, i) => {
          const wResps = sResps.filter(r => { const d = new Date(r.answered_at); return d >= wb.start && d <= wb.end; });
          const valid = wResps.filter(r => !(r.ai_feedback && r.ai_feedback.startsWith("FLAGGED:"))).length;
          const label = i === 0 ? "This wk" : i === 1 ? "Last wk" : `${i}w ago`;
          return { valid, label, weeksAgo: i };
        });
      });

      // Period stats
      const periodResps = (weeksBack) => {
        const cutoff = weeksBack === null ? new Date(0) : getWeekBounds(weeksBack - 1).start;
        return resps.filter(r => new Date(r.answered_at) >= cutoff);
      };
      const mkPeriod = (rs) => ({ total: rs.length, correct: rs.filter(r => r.is_correct).length });

      const thisMonday = thisWeekBounds.start;
      const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);

      // Fetch paper responses from class members so we can fold them into each student's
      // weekValid count — papers reward students the same as retrieval (1 unit per non-flagged answer).
      // classPaperResps is declared at the top of loadCls, so it's already in scope here.
      try {
        const sixtyAgo = new Date(); sixtyAgo.setDate(sixtyAgo.getDate() - 60);
        const classAttempts = await sb.q("paper_attempts", {
          params: {
            class_id: `eq.${c.id}`,
            mode: `eq.full`,
            select: "id,student_id",
            started_at: `gte.${sixtyAgo.toISOString()}`,
          },
        }) || [];
        if (classAttempts.length > 0) {
          const attemptToStudent = {};
          classAttempts.forEach(a => { attemptToStudent[a.id] = a.student_id; });
          const ids = classAttempts.map(a => a.id);
          const prs = await sb.q("paper_responses", {
            params: {
              attempt_id: `in.(${ids.join(",")})`,
              answered_at: `gte.${sixtyAgo.toISOString()}`,
              flagged: "eq.false",
              select: "attempt_id,answered_at,marks_awarded",
            },
          }) || [];
          classPaperResps = prs.map(r => ({ ...r, student_id: attemptToStudent[r.attempt_id] }));
        }
      } catch (e) { console.error("class paper resps load failed", e); }

      // Fold paper responses (this week, non-flagged) into each student's weekValid.
      // Each paper answer counts as 1 unit toward the weekly target — same as a retrieval question.
      classPaperResps.forEach(r => {
        if (!sm[r.student_id]) return;
        const d = new Date(r.answered_at);
        if (d >= thisWeekBounds.start && d <= thisWeekBounds.end) {
          sm[r.student_id].weekValid++;
        }
        // Fold papers into the per-week history too, so the activity-period toggle counts
        // papers consistently across weeks (otherwise prior weeks would undercount paper effort).
        const wi = weekBounds.findIndex(wb => d >= wb.start && d <= wb.end);
        if (wi >= 0 && sm[r.student_id].weeklyHistory && sm[r.student_id].weeklyHistory[wi]) {
          sm[r.student_id].weeklyHistory[wi].valid++;
        }
        // Also bump the all-time totals so the headline numbers reflect paper effort.
        sm[r.student_id].t++;
        if ((r.marks_awarded || 0) > 0) sm[r.student_id].c++;
      });

      // Fetch unresolved marking flags for this class.
      let flags = [];
      try {
        flags = await sb.q("marking_flags", {
          params: {
            class_id: `eq.${c.id}`,
            or: `(resolved.is.null,resolved.eq.false)`,
            order: "created_at.desc",
            select: "id,response_id,student_id,question_id,student_answer,ai_feedback,ai_correct,student_reason,created_at,questions(question_text,marks,model_answer),profiles!marking_flags_student_id_fkey(display_name)",
          },
        }) || [];
      } catch (e) { console.error("flag fetch failed", e); }

      setDash({
        tR: resps.length, tC: resps.filter(r => r.is_correct).length,
        clsTarget,
        recency: ul.filter(t => t.recency_rank).map(t => ({ topicId: t.topic_id, rank: t.recency_rank })).sort((a, b) => a.rank - b.rank),
        thisWeek: mkPeriod(resps.filter(r => new Date(r.answered_at) >= thisMonday)),
        lastWeek: mkPeriod(resps.filter(r => { const d = new Date(r.answered_at); return d >= lastMonday && d < thisMonday; })),
        last4Weeks: mkPeriod(periodResps(4)),
        allTime: mkPeriod(resps),
        students: Object.entries(sm).map(([id, d]) => {
          const target = d.targetOverride ?? clsTarget;
          const over = Math.max(0, d.weekValid - target);
          return { id, ...d, weekStars: Math.floor(over / STAR_INTERVAL) };
        }),
        mis: Object.values(mis).sort((a, b) => b.n - a.n).slice(0, 10),
        tp: Object.entries(tp).map(([name, d]) => ({ name, ...d, pct: d.t ? Math.round(d.c / d.t * 100) : 0 })).sort((a, b) => a.pct - b.pct),
        mems: mems.length,
        flags,
      });
    } catch (e) { console.error(e); }
  };

  const toggleT = async (tid) => {
    if (!cls) return;
    try {
      if (unlocked.has(tid)) {
        await sb.del("class_topics", { class_id: `eq.${cls.id}`, topic_id: `eq.${tid}` });
        setUnlocked(p => { const n = new Set(p); n.delete(tid); return n; });
      } else {
        await sb.q("class_topics", { method: "POST", body: { class_id: cls.id, topic_id: tid, unlocked_by: user.id } });
        setUnlocked(p => new Set(p).add(tid));
      }
    } catch (e) { console.error(e); }
  };

  const saveClsTarget = async (newTarget) => {
    if (!cls || savingTarget) return;
    setSavingTarget(true);
    try {
      await sb.q("classes", { method: "PATCH", params: { id: `eq.${cls.id}` }, body: { weekly_target: newTarget } });
      const updated = { ...cls, weekly_target: newTarget };
      setCls(updated);
      setClasses(prev => prev.map(c => c.id === cls.id ? updated : c));
      await loadCls(updated);
    } catch (e) { console.error(e); }
    setSavingTarget(false);
  };

  // Set a topic as recently taught (rank 1), cascading existing ranks down.
  // Old rank 1 → 2, old rank 2 → 3, old rank 3 → cleared.
  const setTopicRecency = async (topicId) => {
    if (!cls || savingRecency) return;
    setSavingRecency(true);
    try {
      const current = dash?.recency || []; // [{topicId, rank}]
      // Build new rank assignments with cascade
      const filtered = current.filter(r => r.topicId !== topicId); // remove topic if already ranked
      const cascaded = filtered
        .map(r => r.rank < 3 ? { ...r, rank: r.rank + 1 } : null)
        .filter(Boolean);
      const newState = [{ topicId, rank: 1 }, ...cascaded];
      // Clear all current ranks first (unique constraint requires this)
      await Promise.all(current.map(r =>
        sb.q("class_topics", { method: "PATCH", params: { class_id: `eq.${cls.id}`, topic_id: `eq.${r.topicId}` }, body: { recency_rank: null } })
      ));
      // Apply new ranks sequentially
      for (const r of newState) {
        await sb.q("class_topics", { method: "PATCH", params: { class_id: `eq.${cls.id}`, topic_id: `eq.${r.topicId}` }, body: { recency_rank: r.rank } });
      }
      await loadCls(cls);
    } catch (e) { console.error(e); }
    setSavingRecency(false);
  };

  const clearTopicRecency = async (topicId) => {
    if (!cls) return;
    try {
      await sb.q("class_topics", { method: "PATCH", params: { class_id: `eq.${cls.id}`, topic_id: `eq.${topicId}` }, body: { recency_rank: null } });
      await loadCls(cls);
    } catch (e) { console.error(e); }
  };

  const markTaught = async (topicId) => {
    if (!cls) return;
    try {
      if (deliveries[topicId]) {
        // Already marked — unmark (delete)
        await sb.del("lesson_deliveries", { class_id: `eq.${cls.id}`, topic_id: `eq.${topicId}` });
        setDeliveries(p => { const n = { ...p }; delete n[topicId]; return n; });
      } else {
        // Mark as taught today
        await sb.q("lesson_deliveries", { method: "POST", body: { class_id: cls.id, topic_id: topicId, teacher_id: user.id } });
        setDeliveries(p => ({ ...p, [topicId]: { taught_at: new Date().toISOString(), notes: null } }));
      }
    } catch (e) { console.error(e); }
  };

  const generateParentToken = async (studentId) => {
    if (!cls) return null;
    try {
      if (parentTokens[studentId]) {
        // Delete existing and regenerate
        await sb.del("parent_tokens", { student_id: `eq.${studentId}`, class_id: `eq.${cls.id}` });
      }
      const [newToken] = await sb.q("parent_tokens", { method: "POST", body: { student_id: studentId, class_id: cls.id, created_by: user.id } });
      setParentTokens(p => ({ ...p, [studentId]: newToken.token }));
      return newToken.token;
    } catch (e) { console.error(e); return null; }
  };

  const revokeParentToken = async (studentId) => {
    if (!cls) return;
    try {
      await sb.del("parent_tokens", { student_id: `eq.${studentId}`, class_id: `eq.${cls.id}` });
      setParentTokens(p => { const n = { ...p }; delete n[studentId]; return n; });
    } catch (e) { console.error(e); }
  };

  const doSetup = async () => {
    if (!cf.n.trim()) return;
    try {
      // Use existing school and subject, or create if none exist
      let schoolId = sId;
      let subjectId = subId;

      if (!schoolId && schools.length > 0) schoolId = schools[0].id;
      if (!schoolId && fv.trim()) {
        const [s] = await sb.q("schools", { method: "POST", body: { name: fv } });
        setSchools(p => [...p, s]); schoolId = s.id;
      }
      if (!schoolId) { alert("Enter a school name to create your first class."); return; }

      if (!subjectId && subjects.length > 0) {
        // Pick the subject with the most topics (the one with your question bank)
        subjectId = subjects[0].id;
      }
      if (!subjectId) {
        const [s] = await sb.q("subjects", { method: "POST", body: { name: "Science", school_id: schoolId } });
        setSubjects(p => [...p, s]); subjectId = s.id;
      }

      const [c] = await sb.q("classes", { method: "POST", body: { name: cf.n, school_id: schoolId, teacher_id: user.id, subject_id: subjectId, year_group: parseInt(cf.y) || null } });
      const full = await sb.q("classes", { params: { id: `eq.${c.id}`, select: "*,subjects(name)" }, single: true });
      setClasses(p => [...p, full]); setCls(full); setSetup(null); setCf({ n: "", y: "" }); await loadCls(full);
    } catch (e) {
      console.error(e);
      alert("Could not create class: " + (e?.message || "unknown error"));
    }
  };

  if (loading) return <div style={{ color: C.mid, padding: 40, textAlign: "center" }}>Loading...</div>;
  const acc = dash && dash.tR > 0 ? Math.round(dash.tC / dash.tR * 100) : 0;

  // ── CSV export helpers ──────────────────────────────────────────────────
  // Quote a value safely for CSV: wrap in quotes if it contains comma/quote/newline,
  // and escape internal quotes by doubling them.
  const csvEscape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const toCsv = (rows) => rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const downloadCsv = (filename, rows) => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const safeFilename = (s) => (s || "class").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const exportSummaryCsv = () => {
    if (!dash || !cls) return;
    // Build a per-student weakest-topic map from rawResps so we can include it.
    const studentWeakest = {};
    const sTopic = {};
    rawResps.forEach(r => {
      const sid = r.student_id;
      const tname = r.questions?.topics?.name || "—";
      if (!sTopic[sid]) sTopic[sid] = {};
      if (!sTopic[sid][tname]) sTopic[sid][tname] = { t: 0, c: 0 };
      sTopic[sid][tname].t++;
      if (r.is_correct) sTopic[sid][tname].c++;
    });
    Object.keys(sTopic).forEach(sid => {
      // Pick the topic with the lowest accuracy that has at least 3 attempts;
      // otherwise fall back to the topic with the most attempts.
      const entries = Object.entries(sTopic[sid]);
      const eligible = entries.filter(([, d]) => d.t >= 3);
      const sorted = (eligible.length > 0 ? eligible : entries)
        .map(([name, d]) => ({ name, pct: d.t > 0 ? d.c / d.t : 0, t: d.t }))
        .sort((a, b) => a.pct - b.pct || b.t - a.t);
      studentWeakest[sid] = sorted[0]?.name || "—";
    });
    // Last-active map
    const lastActive = {};
    rawResps.forEach(r => {
      const t = new Date(r.answered_at).getTime();
      if (!lastActive[r.student_id] || t > lastActive[r.student_id]) lastActive[r.student_id] = t;
    });

    const header = [
      "Student name", "Email", "Total answers", "Correct", "Accuracy %",
      "This week valid", "Class weekly target", "Personal target",
      "Flagged attempts", "Weakest topic", "Last active"
    ];
    const rows = [header];
    dash.students
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(s => {
        const accPct = s.t > 0 ? Math.round((s.c / s.t) * 100) : 0;
        const last = lastActive[s.id] ? new Date(lastActive[s.id]).toISOString().slice(0, 10) : "";
        rows.push([
          s.name, s.email, s.t, s.c, accPct,
          s.weekValid, dash.clsTarget,
          s.targetOverride ?? "",
          s.flagged,
          studentWeakest[s.id] || "—",
          last,
        ]);
      });
    downloadCsv(`${safeFilename(cls.name)}_summary_${todayStr()}.csv`, rows);
  };

  // Printable class report (opens a clean, self-contained page → Print / Save PDF).
  // For SLT meetings and parents' evening; reuses the dashboard's per-student stats.
  const printReport = () => {
    if (!dash || !cls) return;
    const esc = (s) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const students = dash.students.slice().sort((a, b) => a.name.localeCompare(b.name));
    const tot = students.reduce((n, s) => n + (s.t || 0), 0);
    const cor = students.reduce((n, s) => n + (s.c || 0), 0);
    const clsAcc = tot ? Math.round((cor / tot) * 100) : 0;
    const rows = students.map(s => {
      const acc = s.t > 0 ? Math.round((s.c / s.t) * 100) : 0;
      const accColor = acc >= 70 ? "#16a558" : acc >= 50 ? "#e88019" : "#e54a26";
      return `<tr>
        <td>${esc(s.name)}</td>
        <td class="num">${s.t || 0}</td>
        <td class="num" style="color:${accColor};font-weight:600">${acc}%</td>
        <td class="num">${s.weekValid || 0} / ${dash.clsTarget}</td>
        <td class="num">${s.flagged ? esc(s.flagged) : ""}</td>
      </tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cls.name)} — report</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1a14;margin:32px;max-width:760px}
        h1{font-family:Georgia,serif;font-size:26px;margin:0 0 2px}
        .sub{color:#6f6a5c;font-size:13px;margin-bottom:18px}
        .kpis{display:flex;gap:24px;margin:14px 0 22px;border-top:2px solid #d4cdb8;border-bottom:1px solid #e8e3d6;padding:14px 0}
        .kpi b{font-family:Georgia,serif;font-size:28px;font-weight:500;display:block}
        .kpi span{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#6f6a5c}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #e8e3d6}
        th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6f6a5c}
        td.num,th.num{text-align:right}
        .foot{margin-top:18px;font-size:11px;color:#a8a294}
        @media print{ @page{margin:14mm} .noprint{display:none} }
      </style></head><body>
      <h1>${esc(cls.name)}</h1>
      <div class="sub">Retrieval practice report · ${todayStr()}</div>
      <div class="kpis">
        <div class="kpi"><b>${students.length}</b><span>Pupils</span></div>
        <div class="kpi"><b>${tot}</b><span>Answers</span></div>
        <div class="kpi"><b>${clsAcc}%</b><span>Class accuracy</span></div>
      </div>
      <table><thead><tr><th>Pupil</th><th class="num">Answered</th><th class="num">Accuracy</th><th class="num">This week / target</th><th class="num">Flagged</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="foot">Generated by Feynman Education. Accuracy is over all questions answered; spaced repetition re-tests weak areas automatically.</div>
      <script>window.onload=function(){window.print()}<\/script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  const exportDetailedCsv = () => {
    if (!cls || !rawResps.length) return;
    const header = [
      "Answered at (ISO)", "Student name", "Email",
      "Topic", "Question", "Student answer", "Correct", "Marks awarded", "AI feedback", "Flagged",
    ];
    const rows = [header];
    // Sort by date so the export reads chronologically.
    [...rawResps]
      .sort((a, b) => new Date(a.answered_at) - new Date(b.answered_at))
      .forEach(r => {
        const flagged = r.ai_feedback && r.ai_feedback.startsWith("FLAGGED:");
        const feedback = flagged ? r.ai_feedback.replace(/^FLAGGED:\s*/, "") : (r.ai_feedback || "");
        rows.push([
          new Date(r.answered_at).toISOString(),
          r.profiles?.display_name || "",
          "", // email isn't on the response join — left blank to keep file slim
          r.questions?.topics?.name || "—",
          r.questions?.question_text || "",
          r.student_answer || "",
          r.is_correct ? "yes" : "no",
          r.marks_awarded ?? "",
          feedback,
          flagged ? "yes" : "no",
        ]);
      });
    downloadCsv(`${safeFilename(cls.name)}_detailed_${todayStr()}.csv`, rows);
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 18px 60px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 360px) minmax(0, 1fr)", gap: 12, marginBottom: 18, alignItems: "start" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={cls?.id || ""} onChange={async e => { const c = classes.find(x => x.id === e.target.value); setCls(c); if (c) await loadCls(c); }}
            style={{ flex: 1, padding: "10px 12px", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 14, outline: "none", minHeight: 40 }}>
            <option value="">Select class...</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.year_group ? ` (Y${c.year_group})` : ""}</option>)}
          </select>
          <Btn v="ghost" onClick={() => setSetup("class")} style={{ padding: "10px 14px", fontSize: 13, whiteSpace: "nowrap" }}>+ New</Btn>
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 2, justifyContent: "flex-end" }}>
          {[...(showDept ? ["hod"] : []), ...["dashboard", "review", "starter", "topics", "questions", "papers"], ...(isMod ? ["admin"] : [])].map(t => <Pill key={t} on={tab === t} onClick={() => setTab(t)} style={t === "admin" ? { borderColor: C.pri, color: tab === t ? C.pri : C.pri } : (t === "hod" ? { borderColor: C.amb, color: tab === t ? C.amb : C.amb } : undefined)}>{t === "starter" ? "Lesson Starter" : t === "admin" ? "Admin" : t === "hod" ? "Department" : t === "papers" ? "Papers" : t === "review" ? "Review marks" : t.charAt(0).toUpperCase() + t.slice(1)}</Pill>)}
        </div>
      </div>

      {/* ── First-run onboarding ──
          Shown only to teachers who have no classes yet, or whose only class has no students yet,
          or whose class has students but no responses yet. Dismissible — the dismissal persists
          across sessions via localStorage. New teachers get a 3-step nudge; existing teachers
          who already have an active class never see this. */}
      {!loading && !onboardingDismissed && tab === "dashboard" && (() => {
        const hasClass = classes.length > 0;
        const hasStudents = hasClass && dash && dash.students.length > 0;
        const hasResponses = hasStudents && dash && dash.tR > 0;
        // Three states. We only render if there is still something to do.
        if (hasResponses) return null;

        const Step = ({ n, title, body, action, done }) => (
          <div style={{ display: "flex", gap: 12, padding: "12px 0", alignItems: "flex-start", borderTop: n === 1 ? "none" : `1px solid ${C.bdr}` }}>
            <div style={{
              minWidth: 24, height: 24, borderRadius: 99,
              background: done ? C.grn : (action ? C.pri : C.card2),
              color: done || action ? "#fff" : C.mid,
              fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, marginTop: 2,
            }}>{done ? "✓" : n}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: done ? C.mid : C.txt, textDecoration: done ? "line-through" : "none" }}>{title}</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>{body}</div>
              {action && !done && <div style={{ marginTop: 8 }}>{action}</div>}
            </div>
          </div>
        );

        return (
          <Card style={{ padding: 16, marginBottom: 14, background: C.priSoft, borderColor: "rgba(200,54,45,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 8 }}>
              <div>
                <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>Welcome to Feynman — let's get you set up</div>
                <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>Three quick steps. Takes about 5 minutes.</div>
              </div>
              <button onClick={dismissOnboarding}
                style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "none", background: "transparent", color: C.dim, cursor: "pointer", fontFamily: "inherit" }}>
                Dismiss
              </button>
            </div>

            <div style={{ marginTop: 8 }}>
              <Step n={1} title="Create your first class"
                body="Pick a year group and give it a name (e.g. 10X1). All 92 topics and 822 questions become available — you choose which to unlock for students later."
                done={hasClass}
                action={!hasClass ? <Btn onClick={() => setSetup("class")} style={{ padding: "8px 14px", fontSize: 12 }}>Create class</Btn> : null}
              />
              <Step n={2} title="Add students"
                body={hasClass ? `Share the join code shown on the dashboard, or import a class list from CSV. Both options are below.` : "You'll be able to share a 6-character join code with students, or upload a CSV of names and emails."}
                done={hasStudents}
                action={hasClass && !hasStudents ? <span style={{ fontSize: 11, color: C.dim }}>Use the join code or CSV import below ↓</span> : null}
              />
              <Step n={3} title="Try the Lesson Starter"
                body="Generates a 5-question retrieval starter based on what you just taught. Use it as the do-now next lesson — students answer on phones or laptops, you get a class accuracy reading in 3 minutes."
                done={hasResponses}
                action={hasStudents && !hasResponses ? <Btn v="ghost" onClick={() => setTab("starter")} style={{ padding: "8px 14px", fontSize: 12 }}>Open Lesson Starter</Btn> : null}
              />
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.bdr}`, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
              You can dismiss this any time — once gone, it won't come back.
            </div>
          </Card>
        );
      })()}

      {setup && (
        <Card style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ color: C.txt, fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Create new class</div>
          <div style={{ color: C.dim, fontSize: 12, marginBottom: 14 }}>All 92 topics and 822 questions will be available — use the Topics tab to unlock them for students</div>

          {schools.length === 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 6 }}>School name</div>
              <Inp placeholder="e.g. James Hornsby" value={fv} onChange={e => setFv(e.target.value)} />
            </div>
          )}

          {subjects.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Subject</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {subjects.map(s => <Pill key={s.id} on={subId === s.id} onClick={() => setSubId(s.id)}>{s.name}</Pill>)}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 2 }}>
              <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Class name</div>
              <Inp placeholder="e.g. 10X1" value={cf.n} onChange={e => setCf(p => ({ ...p, n: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Year</div>
              <Inp placeholder="e.g. 10" type="number" value={cf.y} onChange={e => setCf(p => ({ ...p, y: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={doSetup} disabled={!cf.n.trim()} style={{ flex: 1 }}>Create class</Btn>
            <Btn v="ghost" onClick={() => setSetup(null)} style={{ fontSize: 12 }}>Cancel</Btn>
          </div>
        </Card>
      )}

      {!cls ? (
        // Suppress this generic empty state when onboarding is showing —
        // the onboarding panel already gives clear next steps for new teachers.
        (!loading && !onboardingDismissed && classes.length === 0 && tab === "dashboard") ? null :
        <Card style={{ padding: "48px 20px", textAlign: "center" }}><div style={{ color: C.mid }}>Select or create a class.</div></Card>
      ) : (
        <>
          {tab === "dashboard" && dash && (
            <div>
              {/* Editorial header — dateline + standfirst, matches the HoD panel */}
              <Dateline left={cls.name || "Class"} right={new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} style={{ marginBottom: 16 }} />
              <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <Kicker>Class dashboard</Kicker>
                  <Headline size={30} style={{ marginBottom: 6 }}>{cls.name || "Your class"}</Headline>
                  <Deck>{dash.mems} student{dash.mems !== 1 ? "s" : ""} enrolled.</Deck>
                </div>
                <div style={{ textAlign: "right", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 5 }}>Join code</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: C.pri, letterSpacing: 4, fontFamily: "monospace", lineHeight: 1 }}>{cls.join_code || "..."}</div>
                  <div style={{ marginTop: 12, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.dim }}>Export</span>
                    <button onClick={exportSummaryCsv} disabled={!dash || dash.students.length === 0}
                      title="One row per student — totals, accuracy, weakest topic, last active"
                      style={{ padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.pri}`, background: C.priSoft, color: C.pri, cursor: (!dash || dash.students.length === 0) ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: (!dash || dash.students.length === 0) ? 0.5 : 1 }}>
                      ↓ Summary
                    </button>
                    <button onClick={exportDetailedCsv} disabled={!rawResps.length}
                      title="One row per response — every answer with the question, student answer, mark, and feedback"
                      style={{ padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: !rawResps.length ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: !rawResps.length ? 0.5 : 1 }}>
                      ↓ Detailed
                    </button>
                    <button onClick={printReport} disabled={!dash || dash.students.length === 0}
                      title="Printable class report (Print / Save as PDF) for SLT or parents' evening"
                      style={{ padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${C.bdr}`, background: "transparent", color: C.mid, cursor: (!dash || dash.students.length === 0) ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: (!dash || dash.students.length === 0) ? 0.5 : 1 }}>
                      ⎙ Print
                    </button>
                  </div>
                </div>
              </div>

              {/* Command centre — decisions lead the dashboard */}
              {(() => {
                const atRisk = dash.students.filter(s => { const h = s.weeklyHistory; return h && h.length >= 2 && h[0].valid === 0 && h[1].valid === 0; });
                const pd = dash.thisWeek || { total: 0, correct: 0 };
                const pct = pd.total > 0 ? Math.round(pd.correct / pd.total * 100) : 0;
                const weakestTopic = dash.tp?.[0];
                const queue = [
                  ...atRisk.slice(0, 3).map(s => {
                    const lastActive = s.weeklyHistory?.findIndex(w => w.valid > 0);
                    const weeksAgo = (lastActive === -1 || lastActive === undefined) ? "Never active" : lastActive === 0 ? "This week" : `${lastActive}w ago`;
                    return { key: `risk-${s.id}`, tone: C.red, label: "Nudge", title: `${s.name} needs a practice nudge`, detail: `Last active: ${weeksAgo}` };
                  }),
                  ...(dash.flags || []).slice(0, 2).map(f => ({ key: `flag-${f.id}`, tone: C.amb, label: "Review", title: `${f.profiles?.display_name || "Student"} appealed a mark`, detail: f.questions?.question_text || "Open marking flag" })),
                  ...(weakestTopic ? [{ key: "weakest", tone: C.blue, label: "Teach next", title: `${weakestTopic.name} is the weakest topic`, detail: `${weakestTopic.pct}% accuracy across ${weakestTopic.t} answers` }] : []),
                ].slice(0, 4);
                return (
                  <Card style={{ marginBottom: 16, overflow: "hidden", borderColor: "#cdd6df" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, .9fr)" }}>
                      <div style={{ padding: 22 }}>
                        <Badge color={queue.length ? C.red : C.grn}>{queue.length ? `${queue.length} priority item${queue.length === 1 ? "" : "s"}` : "All clear"}</Badge>
                        <Headline size={30} style={{ marginTop: 12, marginBottom: 8 }}>
                          {queue.length ? `${atRisk.length || dash.flags?.length || 1} thing${(atRisk.length || dash.flags?.length || 1) === 1 ? "" : "s"} need attention before Friday.` : "No students need chasing this week."}
                        </Headline>
                        <Deck style={{ maxWidth: 620 }}>
                          Start with the queue, then use the deeper analytics below only when you need the evidence.
                        </Deck>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 18 }}>
                          {[
                            { l: "This week", n: pd.total, c: C.txt, h: "answers" },
                            { l: "Accuracy", n: `${pct}%`, c: pct >= 70 ? C.grn : pct >= 50 ? C.amb : pd.total ? C.red : C.dim, h: "current" },
                            { l: "Below target", n: atRisk.length, c: atRisk.length ? C.red : C.grn, h: "students" },
                            { l: "Open reviews", n: dash.flags?.length || 0, c: dash.flags?.length ? C.amb : C.grn, h: "marks" },
                          ].map(m => (
                            <div key={m.l} style={{ background: C.bg, border: `1px solid ${C.bdrSoft}`, borderRadius: 8, padding: 13 }}>
                              <div style={{ fontSize: 11, color: C.mid, fontWeight: 700 }}>{m.l}</div>
                              <div style={{ fontSize: 30, fontWeight: 800, color: m.c, lineHeight: 1, marginTop: 8 }}>{m.n}</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 5 }}>{m.h}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ padding: 18, background: C.panel, color: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#93a1b2" }}>Attention queue</div>
                        {queue.length === 0 ? (
                          <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#dbe6ef", fontSize: 14 }}>No urgent actions. Use Lesson Starter to keep momentum.</div>
                        ) : queue.map(item => (
                          <div key={item.key} style={{ display: "grid", gridTemplateColumns: "8px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                            <span style={{ width: 8, height: 34, borderRadius: 99, background: item.tone }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                              <span style={{ display: "block", fontSize: 12, color: "#bdc8d4", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.detail}</span>
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                );
              })()}

              {/* Marking flags — student appeals awaiting review */}
              {dash.flags && dash.flags.length > 0 && (
                <Card style={{ padding: 16, marginBottom: 12, borderColor: C.amb, background: C.ambS }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.amb} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
                      <span style={{ color: C.txt, fontWeight: 600, fontSize: 14 }}>
                        Marking flags · {dash.flags.length} awaiting review
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: C.mid }}>
                      Students who think the AI marked them wrong
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {dash.flags.map(f => {
                      const isOpen = expandedFlag === f.id;
                      const busy = flagBusy === f.id;
                      const studentName = f.profiles?.display_name || "?";
                      const qText = f.questions?.question_text || "(question missing)";
                      const maxMarks = f.questions?.marks ?? 1;
                      return (
                        <div key={f.id} style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 4 }}>
                          {/* Row header — always visible */}
                          <button
                            onClick={() => { setExpandedFlag(isOpen ? null : f.id); setFlagNote(""); }}
                            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: C.txt }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{studentName}</div>
                              <div style={{ fontSize: 11, color: C.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {qText}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: C.dim, marginLeft: 10, whiteSpace: "nowrap" }}>
                              {isOpen ? "−" : "+"} {new Date(f.created_at).toLocaleDateString()}
                            </span>
                          </button>

                          {/* Expanded review */}
                          {isOpen && (
                            <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${C.bdr}` }}>
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>Question · {maxMarks} mark{maxMarks !== 1 ? "s" : ""}</div>
                                <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5 }}>{qText}</div>
                              </div>

                              {f.questions?.model_answer && (
                                <div style={{ marginTop: 10 }}>
                                  <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>Model answer</div>
                                  <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.5, padding: "8px 10px", background: C.card2, border: `1px solid ${C.bdr}`, borderRadius: 4 }}>{f.questions.model_answer}</div>
                                </div>
                              )}

                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>Student's answer</div>
                                <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, padding: "8px 10px", background: C.card2, border: `1px solid ${C.bdr}`, borderRadius: 4 }}>{f.student_answer || "(blank)"}</div>
                              </div>

                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>
                                  AI marked as · <span style={{ color: f.ai_correct ? C.grn : C.red, fontWeight: 700 }}>{f.ai_correct ? "correct" : "wrong"}</span>
                                </div>
                                <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.5, padding: "8px 10px", background: C.card2, border: `1px solid ${C.bdr}`, borderRadius: 4 }}>{f.ai_feedback || "(no feedback)"}</div>
                              </div>

                              {f.student_reason && (
                                <div style={{ marginTop: 10 }}>
                                  <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>Student's reason</div>
                                  <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, padding: "8px 10px", background: C.priSoft, border: `1px solid ${C.bdr}`, borderRadius: 4, fontStyle: "italic" }}>"{f.student_reason}"</div>
                                </div>
                              )}

                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 10, color: C.mid, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Note to student (optional)</div>
                                <TA value={flagNote} onChange={e => setFlagNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. You're right — your answer covers the key idea." style={{ fontSize: 13 }} disabled={busy} />
                              </div>

                              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                <Btn onClick={() => resolveFlag(f, "overturned", flagNote)} disabled={busy} style={{ flex: 1, background: C.grn, color: C.bg }}>
                                  {busy ? "Saving..." : `Overturn — award ${maxMarks} mark${maxMarks !== 1 ? "s" : ""}`}
                                </Btn>
                                <Btn v="ghost" onClick={() => resolveFlag(f, "upheld", flagNote)} disabled={busy} style={{ flex: 1 }}>
                                  Uphold AI mark
                                </Btn>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Class activity — FT-style ruled metrics, no box */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                  <Kicker tone={C.dim}>Class · activity</Kicker>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {[
                    { k: "thisWeek", l: "This week" },
                    { k: "lastWeek", l: "Last week" },
                    { k: "last4Weeks", l: "Last 4 weeks" },
                    { k: "allTime", l: "All time" },
                  ].map(({ k, l }) => (
                    <Pill key={k} on={timePeriod === k} onClick={() => setTimePeriod(k)} style={{ fontSize: 12, padding: "6px 12px" }}>{l}</Pill>
                  ))}
                </div>
                {(() => {
                  const pd = dash[timePeriod] || dash.thisWeek;
                  const pct = pd.total > 0 ? Math.round(pd.correct / pd.total * 100) : 0;
                  const metrics = [
                    { n: pd.total, l: "Answered", c: C.txt },
                    { n: pd.correct, l: "Correct", c: C.grn },
                    { n: `${pct}%`, l: "Accuracy", c: pct >= 70 ? C.grn : pct >= 50 ? C.amb : pd.total ? C.red : C.dim },
                  ];
                  return (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${C.bdr}`, borderBottom: `1px solid ${C.bdr}` }}>
                        {metrics.map((m, i) => (
                          <div key={m.l} style={{ padding: "14px 0", paddingLeft: i ? 16 : 0, borderLeft: i ? `1px solid ${C.bdr}` : "none" }}>
                            <div style={{ fontFamily: C.serif, fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: m.c, fontVariantNumeric: "tabular-nums" }}>{m.n}</div>
                            <div style={{ marginTop: 6, fontSize: 9.5, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: C.dim }}>{m.l}</div>
                          </div>
                        ))}
                      </div>
                      {timePeriod === "thisWeek" && dash.lastWeek?.total > 0 && (() => {
                        const diff = (dash.thisWeek?.total || 0) - dash.lastWeek.total;
                        const up = diff > 0, same = diff === 0;
                        return <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: same ? C.dim : up ? C.grn : C.red }}>{same ? "→ Same as" : `${up ? "↑" : "↓"} ${Math.abs(diff)} ${up ? "more" : "fewer"} than`} last week</div>;
                      })()}
                      <div style={{ marginTop: 10, fontSize: 11, color: C.dim }}>All time · {dash.tR} answered · {dash.tC} correct · {acc}% accuracy</div>
                    </>
                  );
                })()}
              </div>

              {/* Class gaps — weakest objectives from the mastery spine, mapped to planning units */}
              <ClassGaps cls={cls} />

              {/* Misconceptions — the specific faulty ideas behind the wrong answers, + one-click targeted reteach */}
              <Misconceptions cls={cls} userId={user.id} />

              {/* ── Insights: detailed analytics, collapsed by default so the dashboard leads with headlines ── */}
              <div style={{ marginTop: 26, marginBottom: 2, fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: C.dim }}>Insights</div>


              <Section label="Students" teaser={`${dash.students.length} enrolled · ${timePeriod === "thisWeek" ? "this week" : timePeriod === "lastWeek" ? "last week" : timePeriod === "last4Weeks" ? "last 4 weeks" : "all time"}`}>
                {dash.students.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>No students yet. Share the join code above.</div> :
                  <StudentList students={dash.students} cls={cls} clsTarget={dash.clsTarget} timePeriod={timePeriod} onRefresh={() => loadCls(cls)} parentTokens={parentTokens} onGenerateToken={generateParentToken} onRevokeToken={revokeParentToken} />}
              </Section>

              <Section label="Top Misconceptions" teaser={dash.mis.length ? `${dash.mis.length} recurring` : "No data yet"}>
                {dash.mis.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>No data yet.</div> :
                  dash.mis.map((m, i) => (
                    <div key={i} style={{ padding: "10px 12px", borderRadius: 10, background: C.card2, borderLeft: `3px solid ${C.red}`, marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                        <div style={{ fontSize: 13, color: C.txt, fontWeight: 500, lineHeight: 1.3 }}>{m.q}</div>
                        <Badge color={C.red} style={{ flexShrink: 0 }}>{m.n}×</Badge>
                      </div>
                      <div style={{ fontSize: 11, color: C.dim }}>{m.topic}</div>
                      {m.ans.length > 0 && <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>{m.ans.map((a, j) => <span key={j} style={{ fontSize: 11, color: C.mid, background: C.redS, padding: "2px 7px", borderRadius: 6 }}>"{a}"</span>)}</div>}
                    </div>
                  ))}
              </Section>

              {/* Question stats — per-question accuracy with drill-down to actual wrong answers.
                  Sorted by wrong-rate; threshold of 3 attempts to avoid noise from one-off blips. */}
              <Section label="Question stats" teaser="hardest questions first · tap for wrong answers">
                {(() => {
                  // Group responses by question_id
                  const qStats = {};
                  rawResps.forEach(r => {
                    if (!r.question_id) return;
                    const isFlagged = r.ai_feedback && r.ai_feedback.startsWith("FLAGGED:");
                    if (isFlagged) return; // exclude flagged spam from question stats
                    if (!qStats[r.question_id]) {
                      qStats[r.question_id] = {
                        id: r.question_id,
                        text: r.questions?.question_text || "(question deleted)",
                        topic: r.questions?.topics?.name || "—",
                        attempts: 0, correct: 0,
                        wrongAnswers: [], // collected up to N for drill-down
                        attemptedBy: new Set(),
                      };
                    }
                    const s = qStats[r.question_id];
                    s.attempts++;
                    if (r.is_correct) s.correct++;
                    else if (r.student_answer && s.wrongAnswers.length < 8) {
                      // Dedupe and cap. Show "× n" if same wrong answer repeats.
                      const existing = s.wrongAnswers.find(w => w.text.toLowerCase().trim() === r.student_answer.toLowerCase().trim());
                      if (existing) existing.count++;
                      else s.wrongAnswers.push({ text: r.student_answer, count: 1 });
                    } else if (!r.is_correct) {
                      // Above the cap — still bump the count if duplicate, ignore otherwise.
                      const existing = s.wrongAnswers.find(w => w.text.toLowerCase().trim() === r.student_answer?.toLowerCase().trim());
                      if (existing) existing.count++;
                    }
                    s.attemptedBy.add(r.student_id);
                  });
                  // Filter and sort: ≥3 attempts, sort by wrong-rate desc, then attempts desc.
                  const qList = Object.values(qStats)
                    .filter(s => s.attempts >= 3)
                    .map(s => ({ ...s, wrongRate: 1 - s.correct / s.attempts, students: s.attemptedBy.size }))
                    .sort((a, b) => b.wrongRate - a.wrongRate || b.attempts - a.attempts)
                    .slice(0, 10);

                  if (qList.length === 0) {
                    return <div style={{ color: C.dim, fontSize: 13 }}>Not enough data yet — questions need at least 3 attempts before they show up here.</div>;
                  }

                  return qList.map((q, i) => {
                    const pct = Math.round(q.wrongRate * 100);
                    const expanded = expandedQuestionStat === q.id;
                    const tone = pct >= 60 ? C.red : pct >= 35 ? C.amb : C.grn;
                    const toneBg = pct >= 60 ? C.redS : pct >= 35 ? C.ambS : C.grnS;
                    return (
                      <div key={q.id} style={{ borderRadius: 10, background: C.card2, borderLeft: `3px solid ${tone}`, marginBottom: 6 }}>
                        <div onClick={() => setExpandedQuestionStat(expanded ? null : q.id)}
                          style={{ padding: "10px 12px", cursor: "pointer", userSelect: "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: C.txt, fontWeight: 500, lineHeight: 1.3 }}>{q.text}</div>
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
                                {q.topic} · {q.students} student{q.students === 1 ? "" : "s"} · {q.attempts} attempt{q.attempts === 1 ? "" : "s"}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: tone, padding: "2px 8px", borderRadius: 6, background: toneBg }}>{pct}% wrong</span>
                              <span style={{ fontSize: 10, color: C.dim }}>{expanded ? "▾" : "▸"} {q.wrongAnswers.length} wrong answer{q.wrongAnswers.length === 1 ? "" : "s"}</span>
                            </div>
                          </div>
                        </div>
                        {expanded && q.wrongAnswers.length > 0 && (
                          <div style={{ padding: "0 12px 10px 14px" }}>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>What students wrote</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {q.wrongAnswers
                                .sort((a, b) => b.count - a.count)
                                .map((w, j) => (
                                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                    <span style={{ color: C.txt, background: C.bg, padding: "3px 8px", borderRadius: 6, flex: 1, fontFamily: "monospace", wordBreak: "break-word" }}>"{w.text}"</span>
                                    {w.count > 1 && <span style={{ fontSize: 10, color: C.mid, fontWeight: 600 }}>× {w.count}</span>}
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </Section>

              <Section label="Topic Performance" teaser={dash.tp.length ? (() => { const w = [...dash.tp].sort((a, b) => a.pct - b.pct)[0]; return w ? `weakest: ${w.name} ${w.pct}%` : `${dash.tp.length} topics`; })() : "No data yet"}>
                {dash.tp.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>No data yet.</div> :
                  dash.tp.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, background: C.card2, marginBottom: 4 }}>
                      <div style={{ flex: 1, color: C.txt, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                      <span style={{ fontSize: 11, color: C.dim }}>{t.t}</span>
                      <div style={{ width: 50 }}><Bar pct={t.pct} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: t.pct >= 70 ? C.grn : t.pct >= 50 ? C.amb : C.red, minWidth: 28, textAlign: "right" }}>{t.pct}%</span>
                    </div>
                  ))}
              </Section>

              {/* Question spread — completion volume + bank coverage per subtopic, classwide and per student.
                  Pure counts only: NO accuracy, NO misconceptions on this panel by design.
                  Fill meter = coverage (distinct questions practised ÷ questions in the topic's bank) — bounded,
                  so a "full" box means the whole bank has been worked through. The raw attempt count (volume)
                  sits alongside it. Subtopic == topic here (CSV subtopics are flattened to topics on import).
                  rawResps + dash.students already in scope; topicBank holds non-archived bank sizes. */}
              <Section label="Question spread" teaser="coverage of each subtopic · tap for students">
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 14, lineHeight: 1.4 }}>
                  Bar fills as distinct questions get practised; figure after the dot is total attempts. Not accuracy.
                </div>
                {(() => {
                  const students = dash?.students || [];
                  // Single pass: per topic, total attempts + set of distinct question_ids, broken down by student.
                  const agg = {};
                  rawResps.forEach(r => {
                    if (r.ai_feedback && r.ai_feedback.startsWith("FLAGGED:")) return; // exclude flagged spam, as the other panels do
                    const tid = r.questions?.topic_id;
                    if (!tid || !r.question_id) return;
                    if (!agg[tid]) agg[tid] = { attempts: 0, distinct: new Set(), byStudent: {} };
                    const a = agg[tid];
                    a.attempts++; a.distinct.add(r.question_id);
                    if (!a.byStudent[r.student_id]) a.byStudent[r.student_id] = { attempts: 0, distinct: new Set() };
                    const s = a.byStudent[r.student_id];
                    s.attempts++; s.distinct.add(r.question_id);
                  });
                  // Only subtopics selected (unlocked) for this class — the ones actually in play.
                  const rows = topics
                    .filter(t => unlocked.has(t.id))
                    .map(t => {
                      const bank = topicBank[t.id] || 0;
                      const a = agg[t.id] || { attempts: 0, distinct: new Set(), byStudent: {} };
                      // distinct can exceed bank if archived questions were answered historically — cap for display.
                      const covered = bank ? Math.min(a.distinct.size, bank) : a.distinct.size;
                      const pct = bank ? Math.min(100, Math.round(a.distinct.size / bank * 100)) : 0;
                      return { id: t.id, name: t.name, bank, attempts: a.attempts, covered, pct, byStudent: a.byStudent };
                    });
                  if (rows.length === 0) return <div style={{ color: C.dim, fontSize: 13 }}>No subtopics selected for this class yet.</div>;
                  return rows.map(row => {
                    const expanded = expandedSpread === row.id;
                    return (
                      <div key={row.id} style={{ borderTop: `1px solid ${C.bdrSoft}`, padding: "11px 0" }}>
                        <div onClick={() => setExpandedSpread(expanded ? null : row.id)} style={{ cursor: "pointer", userSelect: "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
                            <div style={{ fontSize: 13, color: C.txt, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                              <span style={{ color: C.dim, fontSize: 10, marginRight: 7 }}>{expanded ? "▾" : "▸"}</span>{row.name}
                            </div>
                            <div style={{ fontSize: 11, color: C.mid, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                              {row.bank ? `${row.covered}/${row.bank} covered` : "no bank"} · {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                            </div>
                          </div>
                          {/* neutral fill meter — represents a quantity (coverage), deliberately not a status colour */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 8, background: C.bdrSoft, borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ width: `${row.pct}%`, height: "100%", background: C.txt, borderRadius: 2, transition: "width .4s" }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.txt, minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.bank ? `${row.pct}%` : "—"}</span>
                          </div>
                        </div>
                        {expanded && (
                          <div style={{ marginTop: 11, paddingLeft: 17, display: "flex", flexDirection: "column", gap: 8 }}>
                            {students.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>No students in this class.</div> :
                              [...students]
                                .map(st => {
                                  const sd = row.byStudent[st.id] || { attempts: 0, distinct: new Set() };
                                  const sPct = row.bank ? Math.min(100, Math.round(sd.distinct.size / row.bank * 100)) : 0;
                                  return { id: st.id, name: st.name, attempts: sd.attempts, covered: row.bank ? Math.min(sd.distinct.size, row.bank) : sd.distinct.size, pct: sPct };
                                })
                                .sort((x, y) => x.pct - y.pct || x.attempts - y.attempts) // least covered first → surfaces who's missed the subtopic
                                .map(st => (
                                  <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 116, fontSize: 12, color: C.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{st.name}</div>
                                    <div style={{ flex: 1, height: 6, background: C.bdrSoft, borderRadius: 2, overflow: "hidden" }}>
                                      <div style={{ width: `${st.pct}%`, height: "100%", background: C.mid, borderRadius: 2, transition: "width .4s" }} />
                                    </div>
                                    <span style={{ fontSize: 10, color: C.mid, minWidth: 70, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                      {row.bank ? `${st.covered}/${row.bank}` : "—"} · {st.attempts}
                                    </span>
                                  </div>
                                ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </Section>

              {/* ── Class settings: configuration, tucked below the monitoring view ── */}
              <div style={{ marginTop: 28, marginBottom: 2, fontSize: 10, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: C.dim }}>Class settings</div>

              <Section label="Weekly homework target" teaser={`${dash.clsTarget} questions / week`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ color: C.txt, fontWeight: 600, fontSize: 13 }}>Target</div>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, color: C.pri }}>{targetDraft ?? dash.clsTarget}</span>
                </div>
                <input type="range" min={5} max={100} step={5}
                  value={targetDraft ?? dash.clsTarget}
                  onChange={e => setTargetDraft(Number(e.target.value))}
                  onMouseUp={e => { if (targetDraft !== null) saveClsTarget(targetDraft); setTargetDraft(null); }}
                  onTouchEnd={e => { if (targetDraft !== null) saveClsTarget(targetDraft); setTargetDraft(null); }}
                  style={{ width: "100%", accentColor: C.pri, cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: C.dim }}>5</span>
                  <span style={{ fontSize: 10, color: C.dim }}>questions / week · applies to whole class · override per student below</span>
                  <span style={{ fontSize: 10, color: C.dim }}>100</span>
                </div>
              </Section>

              <Section label="Recently taught" teaser={dash.recency?.length ? `${dash.recency.length} topic${dash.recency.length === 1 ? "" : "s"} boosted` : "none set"}>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>Questions from recent topics appear more frequently. Slot 1 gets the strongest boost — students will see it most.</div>
                {/* "What did you just teach?" picker */}
                <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) setTopicRecency(e.target.value); e.target.value = ""; }}
                    disabled={savingRecency}
                    style={{ flex: 1, padding: "9px 10px", background: C.card2, border: `1px solid ${C.bdr}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
                  >
                    <option value="" disabled>{savingRecency ? "Saving..." : "What did you just teach? →"}</option>
                    {topics.filter(t => unlocked.has(t.id)).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                {/* Current slots */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[1, 2, 3].map(rank => {
                    const slot = dash.recency?.find(r => r.rank === rank);
                    const topicName = slot ? topics.find(t => t.id === slot.topicId)?.name : null;
                    const boostLabel = rank === 1 ? "strongest boost" : rank === 2 ? "medium boost" : "light boost";
                    return (
                      <div key={rank} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: C.card2, border: `1px solid ${slot ? "rgba(200,54,45,0.25)" : C.bdr}` }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: slot ? C.priSoft : C.bdr, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: slot ? C.pri : C.dim }}>{rank}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {slot ? (
                            <>
                              <div style={{ fontSize: 13, color: C.txt, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topicName || "Unknown topic"}</div>
                              <div style={{ fontSize: 10, color: C.dim }}>{boostLabel}</div>
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: C.dim, fontStyle: "italic" }}>Not set</div>
                          )}
                        </div>
                        {slot && (
                          <button onClick={() => clearTopicRecency(slot.topicId)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1 }}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>

              <div style={{ borderTop: `2px solid ${C.bdr}`, marginTop: 18, paddingTop: 14 }}>
                <BulkUpload cls={cls} onRefresh={() => loadCls(cls)} />
              </div>
            </div>
          )}

          {tab === "review" && cls && <MarkReview cls={cls} />}

          {tab === "starter" && (
            <LessonStarter topics={topics} unlocked={unlocked} cls={cls} dash={dash} />
          )}

          {tab === "topics" && (
            <TopicSelector topics={topics} unlocked={unlocked} toggleT={toggleT} setUnlocked={setUnlocked} cls={cls} userId={user.id} deliveries={deliveries} onMarkTaught={markTaught} />
          )}

          {tab === "questions" && (planAllows(user, "customQuestions")
            ? <QMgr subjectId={cls.subject_id} userId={user.id} topics={topics} setTopics={setTopics} canPublishShared={isHoD(user) || isModerator(user)} />
            : (
              <div style={{ maxWidth: 560, margin: "20px auto", padding: 24, textAlign: "center", background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12 }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>🔒</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>Writing your own questions is a Core feature</div>
                <div style={{ fontSize: 13, color: C.mid, marginTop: 8, lineHeight: 1.5 }}>Your plan includes the full shared question bank. To author and edit your own questions, upgrade to Core. Tap below and we&rsquo;ll be in touch about unlocking it for your school.</div>
                <RequestCore user={user} />
              </div>
            ))}
          {tab === "papers" && <PaperManager user={user} cls={cls} classes={classes} topics={topics} subjectId={cls.subject_id} />}
          {tab === "admin" && isMod && <AdminPanel user={user} />}
          {tab === "hod" && showDept && <HodPanel user={user} />}
        </>
      )}
    </div>
  );
}

/* ─── Student List with Management Actions ─── */
/* ─── StudentPaperAttempt — student takes a paper question by question ─── */
