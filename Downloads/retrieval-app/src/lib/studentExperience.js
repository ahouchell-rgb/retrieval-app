import { detectFakeAnswer } from "./marking";
import { WEEKLY_TARGET, getWeekBounds } from "./week";

export const SESSION_LENGTHS = [
  { value: 5, label: "Quick", minutes: 4 },
  { value: 10, label: "Standard", minutes: 7 },
  { value: 15, label: "Focused", minutes: 11 },
];

export function effectiveWeeklyTarget(cls) {
  const value = cls?.weekly_target_override ?? cls?.weekly_target ?? WEEKLY_TARGET;
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : WEEKLY_TARGET;
}

export function buildSessionBreakdown(questions = [], srMap = {}, topicStats = [], target = 10, now = new Date()) {
  const weakTopics = new Set(topicStats
    .filter(topic => !topic.isPlaceholder && topic.t > 0 && (topic.c / topic.t) < 0.7)
    .map(topic => topic.topicId));
  const upcoming = questions.slice(0, Math.max(0, target));
  const result = { total: upcoming.length, fresh: 0, due: 0, weak: 0, review: 0, estimatedMinutes: Math.max(1, Math.round(upcoming.length * 0.7)) };

  upcoming.forEach(question => {
    const state = srMap[question.id];
    if (!state || !state.reps) result.fresh += 1;
    else if (!state.due || new Date(state.due) <= now) result.due += 1;
    else if (weakTopics.has(question.topic_id)) result.weak += 1;
    else result.review += 1;
  });
  return result;
}

export function questionReason(question, srMap = {}, topicStats = [], now = new Date()) {
  if (!question) return { label: "Practice", detail: "Chosen for this session" };
  const state = srMap[question.id];
  if (!state || !state.reps) return { label: "New question", detail: "Build your coverage" };
  if (!state.due || new Date(state.due) <= now) return { label: "Due review", detail: "Timed to strengthen your memory" };
  const topic = topicStats.find(item => item.topicId === question.topic_id && !item.isPlaceholder);
  if (topic?.t > 0 && (topic.c / topic.t) < 0.7) return { label: "Weak-area practice", detail: `Strengthen ${topic.name}` };
  return { label: "Keep secure", detail: "A short check to retain this" };
}

export function buildMasterySummary(questions = [], responses = [], srMap = {}, now = new Date()) {
  const valid = responses.filter(response => !detectFakeAnswer(response.student_answer));
  const questionById = new Map(questions.map(question => [question.id, question]));
  const recentStart = new Date(now); recentStart.setDate(recentStart.getDate() - 21);
  const previousStart = new Date(recentStart); previousStart.setDate(previousStart.getDate() - 21);
  const recent = valid.filter(response => new Date(response.answered_at) >= recentStart);
  const previous = valid.filter(response => {
    const answered = new Date(response.answered_at);
    return answered >= previousStart && answered < recentStart;
  });
  const pct = rows => rows.length ? Math.round(rows.filter(row => row.is_correct).length / rows.length * 100) : null;

  const topicPeriods = new Map();
  const add = (rows, period) => rows.forEach(response => {
    const question = questionById.get(response.question_id);
    if (!question?.topic_id) return;
    if (!topicPeriods.has(question.topic_id)) topicPeriods.set(question.topic_id, { name: question.topics?.name || "Topic", recent: [], previous: [] });
    topicPeriods.get(question.topic_id)[period].push(response);
  });
  add(recent, "recent"); add(previous, "previous");
  const strengthened = [...topicPeriods.entries()].flatMap(([topicId, item]) => {
    const current = pct(item.recent), before = pct(item.previous);
    if (item.recent.length < 2 || before == null || current < before + 10) return [];
    return [{ topicId, name: item.name, change: current - before, pct: current }];
  }).sort((a, b) => b.change - a.change);

  let secure = 0, due = 0;
  questions.forEach(question => {
    const state = srMap[question.id];
    if (!state) return;
    if (state.reps >= 4 && state.due && new Date(state.due) > now) secure += 1;
    else if (!state.due || new Date(state.due) <= now || state.reps === 0) due += 1;
  });
  const recentPct = pct(recent), previousPct = pct(previous);
  return {
    secure,
    due,
    recentPct,
    previousPct,
    change: recentPct == null || previousPct == null ? null : recentPct - previousPct,
    strengthened,
  };
}

export function summariseClassProgress(classes = [], responses = [], paperResponses = [], now = new Date()) {
  const { start, end } = getWeekBounds(0, now);
  return classes.map(cls => {
    const retrieval = responses.filter(response => response.class_id === cls.id && new Date(response.answered_at) >= start && new Date(response.answered_at) <= end && !detectFakeAnswer(response.student_answer));
    const papers = paperResponses.filter(response => response.class_id === cls.id && new Date(response.answered_at) >= start && new Date(response.answered_at) <= end);
    const valid = retrieval.length + papers.length;
    const target = effectiveWeeklyTarget(cls);
    return { ...cls, valid, target, remaining: Math.max(0, target - valid), metTarget: valid >= target };
  });
}

export function sortStudentTasks(tasks = [], now = new Date()) {
  const timestamp = value => value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
  return [...tasks].sort((a, b) => {
    const aOverdue = !!a.dueAt && timestamp(a.dueAt) < now.getTime();
    const bOverdue = !!b.dueAt && timestamp(b.dueAt) < now.getTime();
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (timestamp(a.dueAt) !== timestamp(b.dueAt)) return timestamp(a.dueAt) - timestamp(b.dueAt);
    if (!!a.inProgress !== !!b.inProgress) return a.inProgress ? -1 : 1;
    return (a.title || "").localeCompare(b.title || "");
  });
}

export function dueLabel(dueAt, now = new Date()) {
  if (!dueAt) return "No deadline";
  const due = new Date(dueAt);
  const day = 86400000;
  const delta = due.getTime() - now.getTime();
  if (delta < 0) return `Overdue · ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  if (delta < day) return "Due today";
  if (delta < day * 2) return "Due tomorrow";
  return `Due ${due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
}

export function safeLearningFeedback(feedback, modelAnswer, kind) {
  if (kind === "mcq") return "Not quite. Re-read the question, eliminate the least likely options, and try once more.";
  const text = String(feedback || "").trim();
  if (!text) return "One key idea is missing. Re-read the command word and improve the part that answers it directly.";

  const normalise = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalisedFeedback = normalise(text);
  const normalisedAnswer = normalise(modelAnswer);
  const revealingPhrase = /\b(?:the )?(?:correct )?answer (?:is|was)\b/.test(normalisedFeedback);
  const repeatsModelAnswer = normalisedAnswer.length >= 4 && normalisedFeedback.includes(normalisedAnswer);

  return revealingPhrase || repeatsModelAnswer
    ? "One key idea is missing. Re-read the command word and improve the part that answers it directly."
    : text;
}
