import { describe, expect, it } from "vitest";
import { activityCountForPeriod, formatWeekRange, getWeekBounds, matchesActivityFilter } from "./week";

describe("weekly dashboard periods", () => {
  it("uses Monday to Sunday boundaries for a selected week", () => {
    const now = new Date(2026, 7, 24, 12, 0, 0);
    const current = getWeekBounds(0, now);
    const previous = getWeekBounds(1, now);

    expect([current.start.getFullYear(), current.start.getMonth(), current.start.getDate(), current.start.getHours()]).toEqual([2026, 7, 24, 0]);
    expect([current.end.getFullYear(), current.end.getMonth(), current.end.getDate(), current.end.getHours()]).toEqual([2026, 7, 30, 23]);
    expect([previous.start.getFullYear(), previous.start.getMonth(), previous.start.getDate()]).toEqual([2026, 7, 17]);
    expect(formatWeekRange(previous.start, previous.end)).toBe("17 Aug – 23 Aug");
  });

  it("counts either the exact selected week or a rolling window", () => {
    const student = { weeklyHistory: [{ valid: 3 }, { valid: 5 }, { valid: 0 }, { valid: 7 }] };

    expect(activityCountForPeriod(student, { selectedWeek: 1 })).toBe(5);
    expect(activityCountForPeriod(student, { windowWeeks: 2 })).toBe(8);
    expect(activityCountForPeriod(student, { windowWeeks: 4 })).toBe(15);
  });

  it("filters pupils by whether they have activity in the chosen period", () => {
    expect(matchesActivityFilter(4, "active")).toBe(true);
    expect(matchesActivityFilter(0, "active")).toBe(false);
    expect(matchesActivityFilter(0, "inactive")).toBe(true);
    expect(matchesActivityFilter(4, "all")).toBe(true);
  });
});
