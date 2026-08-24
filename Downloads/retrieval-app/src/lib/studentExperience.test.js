import { describe, expect, it } from "vitest";
import { buildMasterySummary, buildSessionBreakdown, dueLabel, effectiveWeeklyTarget, safeLearningFeedback, sortStudentTasks, summariseClassProgress } from "./studentExperience";

const now = new Date("2026-08-24T12:00:00.000Z");

describe("student experience helpers", () => {
  it("uses pupil override before the class target", () => {
    expect(effectiveWeeklyTarget({ weekly_target: 12, weekly_target_override: 7 })).toBe(7);
    expect(effectiveWeeklyTarget({ weekly_target: 12 })).toBe(12);
  });

  it("describes an adaptive session without double-counting categories", () => {
    const questions = [
      { id: "new", topic_id: "a" },
      { id: "due", topic_id: "b" },
      { id: "weak", topic_id: "c" },
      { id: "review", topic_id: "d" },
    ];
    const sr = {
      due: { reps: 2, due: "2026-08-20T00:00:00Z" },
      weak: { reps: 2, due: "2026-09-20T00:00:00Z" },
      review: { reps: 2, due: "2026-09-20T00:00:00Z" },
    };
    const topics = [{ topicId: "c", name: "Cells", t: 5, c: 2 }];
    expect(buildSessionBreakdown(questions, sr, topics, 4, now)).toMatchObject({ total: 4, fresh: 1, due: 1, weak: 1, review: 1 });
  });

  it("shows improvement and secure/due counts", () => {
    const questions = [{ id: "q1", topic_id: "t1", topics: { name: "Cells" } }, { id: "q2", topic_id: "t1", topics: { name: "Cells" } }];
    const responses = [
      { question_id: "q1", student_answer: "old", is_correct: false, answered_at: "2026-07-20T12:00:00Z" },
      { question_id: "q2", student_answer: "old", is_correct: false, answered_at: "2026-07-21T12:00:00Z" },
      { question_id: "q1", student_answer: "new", is_correct: true, answered_at: "2026-08-20T12:00:00Z" },
      { question_id: "q2", student_answer: "new", is_correct: true, answered_at: "2026-08-21T12:00:00Z" },
    ];
    const summary = buildMasterySummary(questions, responses, { q1: { reps: 4, due: "2026-09-01" }, q2: { reps: 0, due: "2026-08-20" } }, now);
    expect(summary.change).toBe(100);
    expect(summary.strengthened[0]).toMatchObject({ name: "Cells", change: 100 });
    expect(summary.secure).toBe(1);
    expect(summary.due).toBe(1);
  });

  it("summarises the current week against each class target", () => {
    const rows = summariseClassProgress(
      [{ id: "c1", weekly_target: 3 }],
      [{ class_id: "c1", answered_at: "2026-08-24T10:00:00Z", student_answer: "valid answer", is_correct: true }],
      [{ class_id: "c1", answered_at: "2026-08-24T11:00:00Z" }],
      now,
    );
    expect(rows[0]).toMatchObject({ valid: 2, target: 3, remaining: 1, metTarget: false });
  });

  it("puts overdue and nearest-due work first", () => {
    const tasks = sortStudentTasks([
      { title: "No date" },
      { title: "Tomorrow", dueAt: "2026-08-25T12:00:00Z" },
      { title: "Late", dueAt: "2026-08-23T12:00:00Z" },
    ], now);
    expect(tasks.map(task => task.title)).toEqual(["Late", "Tomorrow", "No date"]);
    expect(dueLabel(tasks[0].dueAt, now)).toContain("Overdue");
    expect(dueLabel(tasks[1].dueAt, now)).toBe("Due tomorrow");
  });

  it("keeps the model answer hidden until after the supported retry", () => {
    expect(safeLearningFeedback("The correct answer is mitochondria.", "Mitochondria", "free_text")).not.toContain("mitochondria");
    expect(safeLearningFeedback("Look again at which organelle releases energy.", "Mitochondria", "free_text")).toBe("Look again at which organelle releases energy.");
    expect(safeLearningFeedback("The correct option is B.", "Option B", "mcq")).not.toContain("B");
  });
});
