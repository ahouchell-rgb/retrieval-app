import { describe, expect, it } from "vitest";
import { decodePaperVerdict, decodeRetrievalVerdict, validRequestId } from "../../supabase/functions/_shared/ai.ts";

describe("compact AI verdict decoding", () => {
  it("decodes the compact retrieval schema and supplies correct feedback locally", () => {
    expect(decodeRetrievalVerdict({ c: true, m: 2, f: "", x: false, q: "h" })).toEqual({
      correct: true,
      marks_awarded: 2,
      feedback: "",
      flagged: false,
      confidence: "high",
    });
  });

  it("keeps backward compatibility with an in-flight legacy response", () => {
    expect(decodeRetrievalVerdict({ correct: false, marks_awarded: 1, feedback: "Add the cause.", flagged: false, confidence: "medium" })).toEqual({
      correct: false,
      marks_awarded: 1,
      feedback: "Add the cause.",
      flagged: false,
      confidence: "medium",
    });
  });

  it("decodes compact paper verdicts", () => {
    expect(decodePaperVerdict({ m: 2, p: [0, 2], f: "Two points earned.", x: false })).toEqual({
      marks_awarded: 2,
      awarded_points: [0, 2],
      feedback: "Two points earned.",
      flagged: false,
    });
  });
});

describe("request id validation", () => {
  it("accepts UUIDs and rejects arbitrary client strings", () => {
    expect(validRequestId("123e4567-e89b-42d3-a456-426614174000")).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(validRequestId("same-answer-again")).toBeNull();
  });
});
