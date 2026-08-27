import { describe, expect, it } from "vitest";
import { normalizeTeacherSnapshot } from "./dashboardSnapshots";

describe("teacher dashboard snapshots", () => {
  it("normalizes compact database aggregates into the existing dashboard contract", () => {
    const dashboard = normalizeTeacherSnapshot({
      weeks: 2,
      weekly: [{ weeksAgo: 0, total: 7, correct: 5 }, { weeksAgo: 1, total: 3, correct: 1 }],
      students: [{ id: "p1", name: "Ada", t: 10, c: 6, targetOverride: 5, weeklyHistory: [{ weeksAgo: 0, valid: 7 }, { weeksAgo: 1, valid: 3 }] }],
      topics: [{ id: "t1", name: "Cells", t: 4, c: 2, pct: 50 }],
      misconceptions: [{ q: "What is diffusion?", topic: "Cells", n: 3, ans: ["movement"] }],
      interventions: [{ assignmentId: "a1", completedCount: 2, assignedCount: 3, baselinePct: 40, currentPct: 70, change: 30 }],
    }, { clsTarget: 5, recency: [{ topicId: "t1", rank: 1 }], flags: [{ id: "f1" }] });

    expect(dashboard.tR).toBe(10);
    expect(dashboard.tC).toBe(6);
    expect(dashboard.students[0]).toMatchObject({ name: "Ada", weekValid: 7, weekStars: 0 });
    expect(dashboard.weeklyStats[1]).toMatchObject({ total: 3, correct: 1, label: "Last week" });
    expect(dashboard.tp[0]).toMatchObject({ name: "Cells", pct: 50 });
    expect(dashboard.flags).toHaveLength(1);
    expect(dashboard.interventions[0].change).toBe(30);
  });

  it("rejects malformed snapshots so the legacy loader can take over", () => {
    expect(normalizeTeacherSnapshot(null, { clsTarget: 5 })).toBeNull();
    expect(normalizeTeacherSnapshot({ weekly: [] }, { clsTarget: 5 })).toBeNull();
  });
});
