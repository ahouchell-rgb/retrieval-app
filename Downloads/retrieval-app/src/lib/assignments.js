export function assignmentOutcome({ baselinePct, correct = 0, total = 0, completedAt = null }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : null;
  if (!completedAt) return { key: "in_progress", label: "In progress", pct, delta: null };
  const baseline = baselinePct == null ? null : Number(baselinePct);
  const delta = baseline == null || pct == null ? null : pct - baseline;
  if (pct != null && pct >= 70) return { key: "recovered", label: "Recovered", pct, delta };
  if (delta != null && delta >= 15) return { key: "improving", label: "Improving", pct, delta };
  return { key: "still_struggling", label: "Still struggling", pct, delta };
}

export function workStatus({ completedAt = null, dueAt = null, started = false, now = new Date() }) {
  if (completedAt) {
    const late = dueAt && new Date(completedAt) > new Date(dueAt);
    return { key: late ? "completed_late" : "completed", label: late ? "Completed late" : "Completed" };
  }
  const overdue = dueAt && now > new Date(dueAt);
  if (overdue) return { key: started ? "late" : "missing", label: started ? "Late" : "Missing" };
  return { key: started ? "in_progress" : "not_started", label: started ? "In progress" : "Not started" };
}

export function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

export function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
