import { describe, expect, it } from "vitest";

import { runScorer } from "./index.js";

describe("similarity scorer", () => {
  it("passes when token overlap meets min_score", () => {
    const result = runScorer(
      { type: "similarity", reference: "hello world help", min_score: 0.4, case_insensitive: true },
      { output: "Hello! I am here to help you.", latencyMs: 1, costUsd: 0 },
    );
    expect(result.passed).toBe(true);
  });

  it("fails when output is unrelated", () => {
    const result = runScorer(
      { type: "similarity", reference: "refund invoice billing", min_score: 0.6 },
      { output: "The weather is sunny today.", latencyMs: 1, costUsd: 0 },
    );
    expect(result.passed).toBe(false);
  });
});
