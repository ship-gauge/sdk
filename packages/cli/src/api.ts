import type { EvalRunResult } from "./types.js";

export async function uploadEvalRun(
  config: {
    api_key: string;
    project_id: string;
    base_url?: string;
  },
  result: EvalRunResult,
  trigger: "ci" | "manual" = "manual",
): Promise<{ run_id: string }> {
  const baseUrl = config.base_url ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/v1/eval-runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      suite_name: result.suite,
      trigger,
      git_sha: result.git_sha,
      git_ref: result.git_ref,
      pr_number: result.pr_number,
      pass_rate: result.pass_rate,
      avg_cost_usd: result.avg_cost_usd,
      p95_latency_ms: result.p95_latency_ms,
      total_cases: result.total_cases,
      passed_cases: result.passed_cases,
      cases: result.cases.map((c) => ({
        case_id: c.case_id,
        feature_id: c.feature_id,
        passed: c.passed,
        cost_usd: c.cost_usd,
        latency_ms: c.latency_ms,
        failure_reason: c.failure_reason,
        scorer_results: c.scorer_results,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to upload eval run (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return (await response.json()) as { run_id: string };
}

export async function fetchBaseline(
  config: {
    api_key: string;
    project_id: string;
    base_url?: string;
  },
  suite: string,
  gitRef?: string,
): Promise<import("./types.js").EvalRunResult | null> {
  const baseUrl = config.base_url ?? "http://localhost:3000";
  const params = new URLSearchParams({ suite });
  if (gitRef) params.set("ref", gitRef);
  const response = await fetch(
    `${baseUrl}/api/v1/eval-runs/baseline?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${config.api_key}` },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to fetch baseline (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return (await response.json()) as import("./types.js").EvalRunResult;
}

export type BudgetRuleStatus = {
  id: string;
  scope: string;
  scope_id: string | null;
  limit_usd: number;
  spent_usd: number;
  used_pct: number;
  period: string;
};

export type BudgetStatusResponse = {
  project_id: string;
  rules: BudgetRuleStatus[];
  override: { limit_multiplier: number; expires_at: string } | null;
};

export async function fetchBudgetStatus(
  config: {
    api_key: string;
    project_id: string;
    base_url?: string;
  },
): Promise<BudgetStatusResponse> {
  const baseUrl = config.base_url ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/v1/budget-status`, {
    headers: { Authorization: `Bearer ${config.api_key}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to fetch budget status (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return (await response.json()) as BudgetStatusResponse;
}

export async function uploadGateCheck(
  config: {
    api_key: string;
    project_id: string;
    base_url?: string;
  },
  payload: {
    suite_name: string;
    passed: boolean;
    bypassed?: boolean;
    git_sha?: string;
    pr_number?: number;
    report: Record<string, unknown>;
  },
): Promise<{ gate_id: string }> {
  const baseUrl = config.base_url ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/v1/gate-check`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Failed to upload gate check (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return (await response.json()) as { gate_id: string };
}
