export const TEACHER_VIEWS = new Set([
  "dashboard", "assignments", "starter", "review", "papers",
  "topics", "questions", "hod", "admin",
]);

const ACTIVITY_FILTERS = new Set(["all", "active", "inactive"]);
const ACTIVITY_WINDOWS = new Set([0, 2, 3, 4, 6, 8, 12]);

const asBoundedInt = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export function readTeacherWorkspace(search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const activityWindow = asBoundedInt(params.get("activityWindow"), 0, 0, 12);
  return {
    view: TEACHER_VIEWS.has(view) ? view : null,
    classId: params.get("class") || null,
    week: asBoundedInt(params.get("week"), 0, 0, 11),
    activityWindow: ACTIVITY_WINDOWS.has(activityWindow) ? activityWindow : 0,
    activityFilter: ACTIVITY_FILTERS.has(params.get("activity")) ? params.get("activity") : "all",
    studentId: params.get("student") || null,
    topicId: params.get("topic") || null,
  };
}
export function teacherWorkspaceUrl(currentUrl, patch = {}) {
  const url = new URL(currentUrl, "https://retrieval-app.local");
  const current = readTeacherWorkspace(url.search);
  const next = { ...current, ...patch };
  const setOrDelete = (key, value, fallback) => {
    if (value === null || value === undefined || value === "" || value === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  };
  setOrDelete("view", next.view, "dashboard");
  setOrDelete("class", next.classId, null);
  setOrDelete("week", next.week, 0);
  setOrDelete("activityWindow", next.activityWindow, 0);
  setOrDelete("activity", next.activityFilter, "all");
  setOrDelete("student", next.studentId, null);
  setOrDelete("topic", next.topicId, null);
  return `${url.pathname}${url.search}${url.hash}`;
}
