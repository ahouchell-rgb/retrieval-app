import { describe, expect, it } from "vitest";
import { checkNumericalMatch, parseStrictQuantity } from "../../supabase/functions/_shared/marking/numeric.ts";

describe("dimension-aware numerical marking shortcut", () => {
  it.each([
    ["2000", "2,000"],
    ["2000", "2 000"],
    ["2000", "2×10^3"],
    ["0.5", "1/2"],
    ["0.0045", "4.5 x 10^-3"],
    ["0.5", "50%"],
    ["2 m", "200 cm"],
    ["1 kg", "1000 g"],
    ["1 litre", "1000 ml"],
    ["5 m/s", "5 ms-1"],
  ])("accepts equivalent quantities: %s / %s", (model, student) => {
    expect(checkNumericalMatch(model, student)).toBe(true);
  });

  it.each([
    ["5 m", "5 km"],
    ["5 m", "5 s"],
    ["-5", "5"],
    ["50", "50%"],
    ["5 °C", "5 K"],
  ])("rejects different values or dimensions: %s / %s", (model, student) => {
    expect(checkNumericalMatch(model, student)).toBe(false);
  });

  it.each([
    "between 4 and 6",
    "5 or 6",
    "five metres",
    "CO2",
    "5 furlongs",
    "5 m because I calculated it",
  ])("leaves ambiguous answers for AI: %s", (answer) => {
    expect(parseStrictQuantity(answer)).toBeNull();
  });
});
