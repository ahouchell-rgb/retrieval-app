
/* ─── Weekly Boundaries (Mon-Sun) ─── */
export function getWeekBounds(weeksAgo = 0, now = new Date()) {
  const day = now.getDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(now); thisMonday.setHours(0,0,0,0); thisMonday.setDate(now.getDate() + mondayOffset);
  const targetMonday = new Date(thisMonday); targetMonday.setDate(thisMonday.getDate() - (weeksAgo * 7));
  const targetSunday = new Date(targetMonday); targetSunday.setDate(targetMonday.getDate() + 7); targetSunday.setMilliseconds(-1);
  return { start: targetMonday, end: targetSunday };
}

export function formatWeekRange(start, end, locale = "en-GB") {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function activityCountForPeriod(student, { selectedWeek = 0, windowWeeks = 0 } = {}) {
  const history = student?.weeklyHistory || [];
  if (windowWeeks > 0) {
    return history.slice(0, windowWeeks).reduce((total, week) => total + (week?.valid || 0), 0);
  }
  return history[selectedWeek]?.valid || 0;
}

export function matchesActivityFilter(count, filter = "all") {
  if (filter === "active") return count > 0;
  if (filter === "inactive") return count === 0;
  return true;
}

export const WEEKLY_TARGET = 50;
export const STAR_INTERVAL = 25; // bonus star every 25 over target
