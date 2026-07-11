import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { parse as parseYaml } from "yaml";

import type { EvalRunResult } from "./types.js";

export type GateConfig = {
  suite?: string;
  suites_by_env?: Record<string, string>;
  rules: {
    pass_rate?: { min?: number; max_drop?: number };
    avg_cost_usd?: { max_increase?: number };
    p95_latency_ms?: { max_increase?: number };
    fail_on_any_case?: boolean;
  };
  bypass_label?: string;
};

export type GateMetricComparison = {
  baseline: number;
  current: number;
  delta: number;
  delta_pct: number;
  status: "ok" | "warn";
};

export type GateCheckResult = {
  passed: boolean;
  violations: string[];
  baseline: EvalRunResult;
  current: EvalRunResult;
  metrics: {
    pass_rate: GateMetricComparison;
    avg_cost_usd: GateMetricComparison;
    p95_latency_ms: GateMetricComparison;
  };
  failed_cases: string[];
};

const DEFAULT_GATE: GateConfig = {
  suite: "smoke",
  suites_by_env: {
    production: "smoke",
    preview: "smoke",
    development: "smoke",
  },
  rules: {
    pass_rate: { min: 0.95, max_drop: 0.05 },
    avg_cost_usd: { max_increase: 0.2 },
    fail_on_any_case: true,
  },
  bypass_label: "shipgauge-skip",
};

function deltaPct(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / baseline) * 100;
}

export function loadGateConfig(configDir: string): GateConfig {
  const path = join(configDir, ".shipgauge", "gate.yml");
  if (!existsSync(path)) {
    return DEFAULT_GATE;
  }
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as GateConfig;
  return {
    ...DEFAULT_GATE,
    ...parsed,
    rules: { ...DEFAULT_GATE.rules, ...parsed.rules },
    suites_by_env: { ...DEFAULT_GATE.suites_by_env, ...parsed.suites_by_env },
  };
}

export function resolveSuiteName(config: GateConfig, environment?: string): string {
  const env =
    environment ??
    process.env.SHIPGAUGE_ENV ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV;
  if (env && config.suites_by_env?.[env]) {
    return config.suites_by_env[env];
  }
  return config.suite ?? "smoke";
}

export function resolveGitRef(): string | undefined {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  const ref = process.env.GITHUB_REF;
  if (ref?.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  return ref;
}

export function loadBaseline(
  configDir: string,
  suite: string,
): EvalRunResult | null {
  const path = join(configDir, ".shipgauge", "baselines", `${suite}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as EvalRunResult;
}

export function checkGate(
  baseline: EvalRunResult,
  current: EvalRunResult,
  config: GateConfig,
): GateCheckResult {
  const violations: string[] = [];
  const rules = config.rules;

  const passRateDelta = current.pass_rate - baseline.pass_rate;
  const costDeltaPct = deltaPct(baseline.avg_cost_usd, current.avg_cost_usd);
  const latencyDeltaPct = deltaPct(
    baseline.p95_latency_ms,
    current.p95_latency_ms,
  );

  const metrics: GateCheckResult["metrics"] = {
    pass_rate: {
      baseline: baseline.pass_rate,
      current: current.pass_rate,
      delta: passRateDelta,
      delta_pct: passRateDelta * 100,
      status: "ok",
    },
    avg_cost_usd: {
      baseline: baseline.avg_cost_usd,
      current: current.avg_cost_usd,
      delta: current.avg_cost_usd - baseline.avg_cost_usd,
      delta_pct: costDeltaPct,
      status: "ok",
    },
    p95_latency_ms: {
      baseline: baseline.p95_latency_ms,
      current: current.p95_latency_ms,
      delta: current.p95_latency_ms - baseline.p95_latency_ms,
      delta_pct: latencyDeltaPct,
      status: "ok",
    },
  };

  const failedCases = current.cases.filter((c) => !c.passed).map((c) => c.case_id);

  if (rules.fail_on_any_case !== false && failedCases.length > 0) {
    violations.push(`Failed cases: ${failedCases.join(", ")}`);
    metrics.pass_rate.status = "warn";
  }

  if (rules.pass_rate?.min !== undefined && current.pass_rate < rules.pass_rate.min) {
    violations.push(
      `Pass rate ${(current.pass_rate * 100).toFixed(1)}% below min ${(rules.pass_rate.min * 100).toFixed(1)}%`,
    );
    metrics.pass_rate.status = "warn";
  }

  if (
    rules.pass_rate?.max_drop !== undefined &&
    baseline.pass_rate - current.pass_rate > rules.pass_rate.max_drop
  ) {
    violations.push(
      `Pass rate dropped ${((baseline.pass_rate - current.pass_rate) * 100).toFixed(1)}% (max ${(rules.pass_rate.max_drop * 100).toFixed(1)}%)`,
    );
    metrics.pass_rate.status = "warn";
  }

  if (
    rules.avg_cost_usd?.max_increase !== undefined &&
    baseline.avg_cost_usd > 0 &&
    costDeltaPct / 100 > rules.avg_cost_usd.max_increase
  ) {
    violations.push(
      `Avg cost increased ${costDeltaPct.toFixed(1)}% (max ${(rules.avg_cost_usd.max_increase * 100).toFixed(1)}%)`,
    );
    metrics.avg_cost_usd.status = "warn";
  }

  if (
    rules.p95_latency_ms?.max_increase !== undefined &&
    baseline.p95_latency_ms > 0 &&
    latencyDeltaPct / 100 > rules.p95_latency_ms.max_increase
  ) {
    violations.push(
      `P95 latency increased ${latencyDeltaPct.toFixed(1)}% (max ${(rules.p95_latency_ms.max_increase * 100).toFixed(1)}%)`,
    );
    metrics.p95_latency_ms.status = "warn";
  }

  return {
    passed: violations.length === 0,
    violations,
    baseline,
    current,
    metrics,
    failed_cases: failedCases,
  };
}

function formatDelta(value: number, suffix = "%"): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${suffix}`;
}

function statusEmoji(status: "ok" | "warn"): string {
  return status === "ok" ? "✅" : "⚠️";
}

export function formatGateReport(result: GateCheckResult): string {
  const icon = result.passed ? "✅" : "❌";
  const title = result.passed ? "Passed" : "Blocked";
  const lines: string[] = [];

  lines.push(`${icon} ShipGauge Gate — ${title}`);
  lines.push("");
  lines.push(
    `| Metric | Baseline | This run | Δ |`,
  );
  lines.push(`|--------|----------|----------|---|`);
  lines.push(
    `| Pass rate | ${(result.metrics.pass_rate.baseline * 100).toFixed(0)}% | ${(result.metrics.pass_rate.current * 100).toFixed(0)}% | ${formatDelta(result.metrics.pass_rate.delta_pct)} ${statusEmoji(result.metrics.pass_rate.status)} |`,
  );
  lines.push(
    `| Avg cost/req | $${result.metrics.avg_cost_usd.baseline.toFixed(4)} | $${result.metrics.avg_cost_usd.current.toFixed(4)} | ${formatDelta(result.metrics.avg_cost_usd.delta_pct)} ${statusEmoji(result.metrics.avg_cost_usd.status)} |`,
  );
  lines.push(
    `| P95 latency | ${result.metrics.p95_latency_ms.baseline}ms | ${result.metrics.p95_latency_ms.current}ms | ${formatDelta(result.metrics.p95_latency_ms.delta_pct)} ${statusEmoji(result.metrics.p95_latency_ms.status)} |`,
  );

  if (result.failed_cases.length > 0) {
    lines.push("");
    lines.push(`Failed cases: \`${result.failed_cases.join("`, `")}\``);
  }

  if (result.violations.length > 0) {
    lines.push("");
    lines.push("Violations:");
    for (const v of result.violations) {
      lines.push(`  • ${v}`);
    }
  }

  return lines.join("\n");
}

export function formatPrComment(result: GateCheckResult, bypassLabel = "shipgauge-skip"): string {
  const icon = result.passed ? "✅" : "❌";
  const title = result.passed ? "Passed" : "Blocked";
  const lines: string[] = [];

  lines.push(`## ShipGauge Gate — ${icon} ${title}`);
  lines.push("");
  lines.push("| Metric | Baseline | This PR | Δ |");
  lines.push("|--------|----------|---------|---|");
  lines.push(
    `| Pass rate | ${(result.metrics.pass_rate.baseline * 100).toFixed(0)}% | ${(result.metrics.pass_rate.current * 100).toFixed(0)}% | ${formatDelta(result.metrics.pass_rate.delta_pct)} ${statusEmoji(result.metrics.pass_rate.status)} |`,
  );
  lines.push(
    `| Avg cost/req | $${result.metrics.avg_cost_usd.baseline.toFixed(4)} | $${result.metrics.avg_cost_usd.current.toFixed(4)} | ${formatDelta(result.metrics.avg_cost_usd.delta_pct)} ${statusEmoji(result.metrics.avg_cost_usd.status)} |`,
  );
  lines.push(
    `| P95 latency | ${(result.metrics.p95_latency_ms.baseline / 1000).toFixed(1)}s | ${(result.metrics.p95_latency_ms.current / 1000).toFixed(1)}s | ${formatDelta(result.metrics.p95_latency_ms.delta_pct)} ${statusEmoji(result.metrics.p95_latency_ms.status)} |`,
  );

  if (result.failed_cases.length > 0) {
    lines.push("");
    lines.push(`Failed cases: \`${result.failed_cases.join("`, `")}\``);
  }

  lines.push("");
  lines.push(
    result.passed
      ? "_All gate rules passed. Safe to merge._"
      : `_Gate blocked. Fix failures or add the \`${bypassLabel}\` label to bypass._`,
  );

  return lines.join("\n");
}

function readGithubEvent(): Record<string, unknown> | null {
  if (!process.env.GITHUB_EVENT_PATH) return null;
  try {
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function githubCheckContext(): {
  token: string;
  repo: string;
  headSha: string;
} {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const event = readGithubEvent();
  const headSha =
    process.env.GITHUB_SHA ??
    (event?.pull_request as { head?: { sha?: string } } | undefined)?.head?.sha ??
    (event?.head_commit as { id?: string } | undefined)?.id ??
    (typeof event?.after === "string" ? event.after : undefined);

  if (!token || !repo || !headSha) {
    throw new Error(
      "GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_SHA (or event head SHA) required for check runs",
    );
  }

  return { token, repo, headSha };
}

function githubPrContext(): {
  token: string;
  repo: string;
  prNumber: number;
  headSha: string;
} {
  const { token, repo, headSha } = githubCheckContext();
  const prNumberRaw =
    process.env.GITHUB_PR_NUMBER ??
    (readGithubEvent()?.pull_request as { number?: number } | undefined)?.number;
  const prNumber = prNumberRaw != null ? Number(prNumberRaw) : undefined;

  if (!prNumber) {
    throw new Error("PR number required for GitHub PR comments");
  }

  return { token, repo, prNumber, headSha };
}

export const PR_COMMENT_MARKER = "<!-- shipgauge-gate -->";

export function withPrCommentMarker(body: string): string {
  if (body.includes(PR_COMMENT_MARKER)) return body;
  return `${PR_COMMENT_MARKER}\n${body}`;
}

export function findShipGaugePrCommentId(
  comments: Array<{ id: number; body?: string }>,
): number | null {
  for (const comment of comments) {
    if (
      comment.body?.includes(PR_COMMENT_MARKER) ||
      comment.body?.includes("## ShipGauge Gate —")
    ) {
      return comment.id;
    }
  }
  return null;
}

export async function upsertPrComment(body: string): Promise<"created" | "updated"> {
  const marked = withPrCommentMarker(body);
  const { token, repo, prNumber } = githubPrContext();

  const listResponse = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!listResponse.ok) {
    const err = await listResponse.text();
    throw new Error(`GitHub API error (${listResponse.status}): ${err}`);
  }

  const comments = (await listResponse.json()) as Array<{ id: number; body?: string }>;
  const existingId = findShipGaugePrCommentId(comments);

  if (existingId) {
    const patchResponse = await fetch(
      `https://api.github.com/repos/${repo}/issues/comments/${existingId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: marked }),
      },
    );

    if (!patchResponse.ok) {
      const err = await patchResponse.text();
      throw new Error(`GitHub API error (${patchResponse.status}): ${err}`);
    }

    return "updated";
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: marked }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${err}`);
  }

  return "created";
}

/** @deprecated Use upsertPrComment */
export async function postPrComment(body: string): Promise<void> {
  await upsertPrComment(body);
}

export async function postGitHubCheckRun(
  result: GateCheckResult,
  bypassed: boolean,
  options?: { bypassLabel?: string },
): Promise<void> {
  const { token, repo, headSha } = githubCheckContext();
  const passed = result.passed || bypassed;
  const bypassLabel = options?.bypassLabel ?? "shipgauge-skip";
  const title = passed
    ? bypassed && !result.passed
      ? "ShipGauge Gate (bypassed)"
      : "ShipGauge Gate passed"
    : "ShipGauge Gate failed";

  const summary = formatPrComment(result, bypassLabel);
  const response = await fetch(`https://api.github.com/repos/${repo}/check-runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "ShipGauge Gate",
      head_sha: headSha,
      status: "completed",
      conclusion: passed ? "success" : "failure",
      external_id: `shipgauge-gate-${headSha.slice(0, 12)}`,
      output: {
        title,
        summary,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub check run error (${response.status}): ${err}`);
  }
}

export async function postGitHubCheckRunSimple(input: {
  passed: boolean;
  summary: string;
  title?: string;
}): Promise<void> {
  const { token, repo, headSha } = githubCheckContext();
  const response = await fetch(`https://api.github.com/repos/${repo}/check-runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "ShipGauge Gate",
      head_sha: headSha,
      status: "completed",
      conclusion: input.passed ? "success" : "failure",
      external_id: `shipgauge-gate-${headSha.slice(0, 12)}`,
      output: {
        title: input.title ?? (input.passed ? "ShipGauge Gate passed" : "ShipGauge Gate failed"),
        summary: input.summary,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub check run error (${response.status}): ${err}`);
  }
}
