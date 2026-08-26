import { describe, expect, it } from "vitest";
import { readTeacherWorkspace, teacherWorkspaceUrl } from "./workspaceState";

describe("teacher workspace URL state", () => {
  it("reads valid deep-link state", () => {
    expect(readTeacherWorkspace("?view=review&class=c1&week=3&activityWindow=4&activity=inactive")).toEqual({
      view: "review", classId: "c1", week: 3, activityWindow: 4, activityFilter: "inactive",
    });
  });

  it("falls back safely for unsupported values", () => {
    expect(readTeacherWorkspace("?view=secret&week=99&activityWindow=5&activity=missing")).toEqual({
      view: null, classId: null, week: 0, activityWindow: 0, activityFilter: "all",
    });
  });

  it("preserves unrelated query parameters while removing defaults", () => {
    expect(teacherWorkspaceUrl("https://example.com/?campaign=pilot&view=review&week=2", {
      view: "dashboard", week: 0, classId: "class-2",
    })).toBe("/?campaign=pilot&class=class-2");
  });
});
