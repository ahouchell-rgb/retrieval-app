import { describe, expect, it } from "vitest";
import { assignmentOutcome, fromLocalInputValue, workStatus } from "./assignments";

describe("assignmentOutcome", () => {
  it("only reports an outcome after completion", () => {
    expect(assignmentOutcome({ baselinePct: 20, correct: 4, total: 5 }).key).toBe("in_progress");
  });

  it("reports recovery at 70 percent or above", () => {
    expect(assignmentOutcome({ baselinePct: 35, correct: 4, total: 5, completedAt: "2026-08-21" }).key).toBe("recovered");
  });

  it("reports improvement when the gain is at least 15 points", () => {
    const result = assignmentOutcome({ baselinePct: 30, correct: 2, total: 4, completedAt: "2026-08-21" });
    expect(result.key).toBe("improving");
    expect(result.delta).toBe(20);
  });

  it("keeps weak completed work visible", () => {
    expect(assignmentOutcome({ baselinePct: 30, correct: 1, total: 5, completedAt: "2026-08-21" }).key).toBe("still_struggling");
  });
});

describe("workStatus", () => {
  const now = new Date("2026-08-21T12:00:00Z");

  it("distinguishes missing from late work", () => {
    const dueAt = "2026-08-20T12:00:00Z";
    expect(workStatus({ dueAt, now }).key).toBe("missing");
    expect(workStatus({ dueAt, started: true, now }).key).toBe("late");
  });

  it("records completion after the deadline", () => {
    expect(workStatus({ dueAt: "2026-08-20T12:00:00Z", completedAt: "2026-08-21T10:00:00Z", now }).key).toBe("completed_late");
  });
});

describe("fromLocalInputValue", () => {
  it("returns null for an empty field", () => {
    expect(fromLocalInputValue("")).toBeNull();
  });
});
