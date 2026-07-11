import { describe, expect, it, vi, afterEach } from "vitest";

import { checkGate, githubCheckContext, findShipGaugePrCommentId, withPrCommentMarker, type GateConfig } from "./gate.js";
import type { EvalRunResult } from "./types.js";

const baseRun = (overrides: Partial<EvalRunResult> = {}): EvalRunResult => ({
  suite: "smoke",
  pass_rate: 1,
  avg_cost_usd: 0.01,
  p95_latency_ms: 100,
  total_cases: 1,
  passed_cases: 1,
  cases: [
    {
      case_id: "a",
      passed: true,
      cost_usd: 0.01,
      latency_ms: 100,
      scorer_results: [],
    },
  ],
  ...overrides,
});

describe("checkGate", () => {
  it("blocks when pass rate drops beyond max_drop", () => {
    const config: GateConfig = {
      rules: { pass_rate: { min: 0.9, max_drop: 0.05 }, fail_on_any_case: true },
    };
    const result = checkGate(
      baseRun({ pass_rate: 1 }),
      baseRun({ pass_rate: 0.9 }),
      config,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("passes when within thresholds", () => {
    const config: GateConfig = {
      rules: {
        pass_rate: { min: 0.95, max_drop: 0.05 },
        avg_cost_usd: { max_increase: 0.2 },
        fail_on_any_case: true,
      },
    };
    const result = checkGate(
      baseRun({ pass_rate: 1, avg_cost_usd: 0.01 }),
      baseRun({ pass_rate: 0.98, avg_cost_usd: 0.011 }),
      config,
    );
    expect(result.passed).toBe(true);
  });
});

describe("PR comment upsert helpers", () => {
  it("adds hidden marker once", () => {
    const body = "## ShipGauge Gate";
    expect(withPrCommentMarker(body)).toContain("<!-- shipgauge-gate -->");
    expect(withPrCommentMarker(withPrCommentMarker(body)).match(/<!-- shipgauge-gate -->/g)).toHaveLength(1);
  });

  it("finds existing ShipGauge comment", () => {
    const id = findShipGaugePrCommentId([
      { id: 1, body: "other" },
      { id: 42, body: "<!-- shipgauge-gate -->\n## ShipGauge Gate" },
    ]);
    expect(id).toBe(42);
  });
});

describe("githubCheckContext", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("uses GITHUB_SHA without PR context", () => {
    vi.stubEnv("GITHUB_TOKEN", "token");
    vi.stubEnv("GITHUB_REPOSITORY", "acme/app");
    vi.stubEnv("GITHUB_SHA", "abc123");
    const ctx = githubCheckContext();
    expect(ctx.headSha).toBe("abc123");
    expect(ctx.repo).toBe("acme/app");
  });
});
