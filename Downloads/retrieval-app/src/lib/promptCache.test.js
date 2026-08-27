import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// COST GUARDRAIL — keep both AI markers above OpenAI's 1024-token prompt-cache floor.
//
// Each marker sends a stable subject-agnostic engine followed by a per-subject
// overlay (see supabase/functions/_shared/marking/). OpenAI caches eligible exact
// prompt prefixes automatically, while the question and pupil answer remain dynamic.
//
// BELOW the floor the cache silently never writes — no error, you just pay full input
// price on every call and cached_tokens stays 0. This tripwire fails if a careless
// edit trims a base or overlay so far
// that some base+overlay pair drops toward the floor.
//
// We use a conservative char proxy: ~4 chars/token for English, so 1024 tokens is
// roughly 4096 characters. The AUTHORITATIVE check
// remains cache_read_tokens > 0 in ai_usage after deploy — this just catches the
// obvious "someone shortened the prompt" mistake in CI.
const FLOOR_CHARS = 4096; // 1024 tokens × ~4 chars/token

function extractConst(relPath, name) {
  const src = readFileSync(new URL(relPath, import.meta.url), "utf8");
  const m = src.match(new RegExp("export const " + name + " = `([\\s\\S]*?)`;"));
  if (!m) throw new Error(`${name} template literal not found in ${relPath}`);
  return m[1];
}

// Every (marker, subject) pair that an AI mark can actually send. Add a row when a new
// subject overlay is registered in _shared/marking/registry.ts.
const MARKING_DIR = "../../supabase/functions/_shared/marking/";
const PAIRS = [
  ["mark-answer / science", `${MARKING_DIR}base-retrieval.ts`, "BASE_RETRIEVAL", `${MARKING_DIR}overlays/science.ts`, "SCIENCE_RETRIEVAL_OVERLAY"],
  ["mark-paper-answer / science", `${MARKING_DIR}base-paper.ts`, "BASE_PAPER", `${MARKING_DIR}overlays/science.ts`, "SCIENCE_PAPER_OVERLAY"],
];

describe("AI marker prompt-cache floor", () => {
  for (const [label, baseFile, baseVar, overlayFile, overlayVar] of PAIRS) {
    it(`${label} base + overlay stays above the 1024-token cacheable floor`, () => {
      const len = extractConst(baseFile, baseVar).length + extractConst(overlayFile, overlayVar).length;
      expect(len, `${label} base+overlay is ${len} chars — below the ${FLOOR_CHARS}-char (~1024-token) cache floor; prompt caching will silently turn off`).toBeGreaterThanOrEqual(FLOOR_CHARS);
    });
  }
});
