import { STAR_INTERVAL, formatWeekRange, getWeekBounds } from "./week";

const asNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function normalizeTeacherSnapshot(snapshot, { clsTarget, recency = [], flags = [], memberCount } = {}) {
  if (!snapshot || !Array.isArray(snapshot.weekly) || !Array.isArray(snapshot.students)) return null;

  const weeklyByIndex = new Map(snapshot.weekly.map(week => [asNumber(week.weeksAgo), week]));
  const weekCount = Math.max(1, Math.min(12, asNumber(snapshot.weeks, 12)));
  const weeklyStats = Array.from({ length: weekCount }, (_, weeksAgo) => {
    const bounds = getWeekBounds(weeksAgo);
    const week = weeklyByIndex.get(weeksAgo) || {};
    return {
      weeksAgo,
      label: weeksAgo === 0 ? "This week" : weeksAgo === 1 ? "Last week" : `${weeksAgo} weeks ago`,
      range: formatWeekRange(bounds.start, bounds.end),
      total: asNumber(week.total),
      correct: asNumber(week.correct),
    };
  });

  const students = snapshot.students.map(student => {
    const total = asNumber(student.t);
    const correct = asNumber(student.c);
    const targetOverride = student.targetOverride == null ? null : asNumber(student.targetOverride);
    const weeklyHistory = weeklyStats.map(week => {
      const history = (student.weeklyHistory || []).find(item => asNumber(item.weeksAgo, -1) === week.weeksAgo);
      return { valid: asNumber(history?.valid), label: week.weeksAgo === 0 ? "This wk" : week.weeksAgo === 1 ? "Last wk" : `${week.weeksAgo}w ago`, weeksAgo: week.weeksAgo, range: week.range };
    });
    const target = targetOverride ?? clsTarget;
    const weekValid = weeklyHistory[0]?.valid || 0;
    return {
      id: student.id,
      name: student.name || "Pupil",
      email: student.email || "",
      t: total,
      c: correct,
      weekValid,
      weekStars: Math.floor(Math.max(0, weekValid - target) / STAR_INTERVAL),
      flagged: asNumber(student.flagged),
      targetOverride,
      weeklyHistory,
    };
  });

  const total = weeklyStats.reduce((sum, week) => sum + week.total, 0);
  const correct = weeklyStats.reduce((sum, week) => sum + week.correct, 0);
  return {
    tR: total,
    tC: correct,
    clsTarget,
    recency,
    weeklyStats,
    thisWeek: weeklyStats[0],
    lastWeek: weeklyStats[1] || { total: 0, correct: 0 },
    last4Weeks: weeklyStats.slice(0, 4).reduce((result, week) => ({ total: result.total + week.total, correct: result.correct + week.correct }), { total: 0, correct: 0 }),
    allTime: { total, correct },
    students,
    mis: Array.isArray(snapshot.misconceptions) ? snapshot.misconceptions : [],
    tp: Array.isArray(snapshot.topics) ? snapshot.topics.map(topic => ({ ...topic, t: asNumber(topic.t), c: asNumber(topic.c), pct: asNumber(topic.pct) })) : [],
    interventions: Array.isArray(snapshot.interventions) ? snapshot.interventions : [],
    mems: memberCount ?? students.length,
    flags,
    generatedAt: snapshot.generatedAt || null,
  };
}
