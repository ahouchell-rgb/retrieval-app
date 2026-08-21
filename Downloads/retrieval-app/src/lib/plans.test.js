import { describe, expect, it } from "vitest";
import { PLAN_ORDER, PLANS, SCHOOL_ANNUAL_PRICE_GBP, SCHOOL_ANNUAL_PRICE_LABEL } from "./plans.js";

describe("school pricing", () => {
  it("uses one £800 annual School plan for new paid schools", () => {
    expect(SCHOOL_ANNUAL_PRICE_GBP).toBe(800);
    expect(SCHOOL_ANNUAL_PRICE_LABEL).toBe("£800");
    expect(PLANS.core).toMatchObject({
      label: "School",
      priceLabel: "£800 / school / yr",
      customQuestions: true,
      leadership: true,
      mis: true,
    });
    expect(PLAN_ORDER.slice(0, 2)).toEqual(["free", "core"]);
  });

  it("retains legacy plan keys for existing school records", () => {
    expect(PLANS.essentials.label).toContain("Legacy");
    expect(PLANS.single_cohort.label).toContain("Legacy");
  });
});
