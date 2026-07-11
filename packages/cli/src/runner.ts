import {
  allScorersPassed,
  runScorersAsync,
  type ScorerConfig,
} from "@shipgauge/scorers";

import { invokeCase } from "./invoke.js";
import {
  applyCaseDefaults,
  loadSuite,
  resolveInvoke,
  resolveSuitePath,
} from "./suite.js";
import type { CaseResult, EvalRunResult, SuiteFile } from "./types.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export async function runSuite(options: {
  suitePath: string;
  gitSha?: string;
  gitRef?: string;
  prNumber?: number;
  customScorers?: Record<string, ScorerConfig[]>;
}): Promise<EvalRunResult> {
  const suite = loadSuite(options.suitePath);
  const caseResults: CaseResult[] = [];

  for (const rawCase of suite.cases) {
    const caseDef = applyCaseDefaults(suite, rawCase);
    const invoke = resolveInvoke(caseDef);
    const model = caseDef.model ?? suite.defaults?.model ?? "gpt-4o-mini";
    const timeoutMs = caseDef.timeout_ms ?? suite.defaults?.timeout_ms ?? 30_000;
    const scorers: ScorerConfig[] = caseDef.scorers ?? [];

    let invokeResult;
    try {
      invokeResult = await invokeCase(invoke!, model, timeoutMs);
    } catch (error) {
      caseResults.push({
        case_id: caseDef.id,
        feature_id: caseDef.feature_id ?? suite.defaults?.feature_id,
        passed: false,
        cost_usd: 0,
        latency_ms: 0,
        failure_reason:
          error instanceof Error ? error.message : "Invoke failed",
        scorer_results: [],
      });
      continue;
    }

    const scorerResults = await runScorersAsync(scorers, {
      output: invokeResult.output,
      latencyMs: invokeResult.latency_ms,
      costUsd: invokeResult.cost_usd,
      caseId: caseDef.id,
    }, { customScorers: options.customScorers });

    const passed = scorers.length === 0 ? true : allScorersPassed(scorerResults);
    const failedScorer = scorerResults.find((r) => !r.passed);

    caseResults.push({
      case_id: caseDef.id,
      feature_id: caseDef.feature_id ?? suite.defaults?.feature_id,
      passed,
      cost_usd: invokeResult.cost_usd,
      latency_ms: invokeResult.latency_ms,
      failure_reason: passed ? undefined : failedScorer?.message,
      scorer_results: scorerResults,
    });
  }

  const passedCases = caseResults.filter((c) => c.passed).length;
  const totalCases = caseResults.length;
  const costs = caseResults.map((c) => c.cost_usd);
  const latencies = caseResults.map((c) => c.latency_ms);

  return {
    suite: suite.name,
    pass_rate: totalCases > 0 ? passedCases / totalCases : 0,
    avg_cost_usd:
      costs.length > 0
        ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6))
        : 0,
    p95_latency_ms: percentile(latencies, 95),
    total_cases: totalCases,
    passed_cases: passedCases,
    cases: caseResults,
    git_sha: options.gitSha,
    git_ref: options.gitRef,
    pr_number: options.prNumber,
  };
}

export function findAndRunSuite(options: {
  suiteName: string;
  suitesDir: string;
  cwd: string;
  gitSha?: string;
  gitRef?: string;
  prNumber?: number;
  customScorers?: Record<string, ScorerConfig[]>;
}): Promise<EvalRunResult> {
  const suitePath = resolveSuitePath(
    options.suitesDir,
    options.suiteName,
    options.cwd,
  );
  return runSuite({
    suitePath,
    gitSha: options.gitSha,
    gitRef: options.gitRef,
    prNumber: options.prNumber,
    customScorers: options.customScorers,
  });
}

export function formatReport(result: EvalRunResult): string {
  const lines: string[] = [];
  const icon = result.passed_cases === result.total_cases ? "✅" : "❌";

  lines.push(`${icon} ShipGauge Eval — ${result.suite}`);
  lines.push(
    `Pass rate: ${(result.pass_rate * 100).toFixed(1)}% (${result.passed_cases}/${result.total_cases})`,
  );
  lines.push(`Avg cost: $${result.avg_cost_usd.toFixed(4)}`);
  lines.push(`P95 latency: ${result.p95_latency_ms}ms`);
  lines.push("");
  lines.push("Cases:");

  for (const c of result.cases) {
    const status = c.passed ? "✅" : "❌";
    const detail = c.passed
      ? `$${c.cost_usd.toFixed(4)} · ${c.latency_ms}ms`
      : c.failure_reason ?? "failed";
    lines.push(`  ${status} ${c.case_id} — ${detail}`);
  }

  return lines.join("\n");
}

export type { SuiteFile };
