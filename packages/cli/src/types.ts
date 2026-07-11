import type { ScorerConfig } from "@shipgauge/scorers";

export type ShipGaugeConfig = {
  api_key: string;
  project_id: string;
  base_url?: string;
  suites_dir?: string;
};

export type InvokeConfig =
  | { type: "mock"; output: string; latency_ms?: number; cost_usd?: number }
  | {
      type: "openai";
      messages: Array<{ role: string; content: string }>;
      model?: string;
    }
  | {
      type: "http";
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      json_path?: string;
      cost_usd?: number;
      latency_ms?: number;
    }
  | { type: "template"; template: string };

export type SuiteCase = {
  id: string;
  feature_id?: string;
  model?: string;
  timeout_ms?: number;
  vars?: Record<string, string>;
  input?: {
    messages?: Array<{ role: string; content: string }>;
  };
  invoke?: InvokeConfig;
  scorers?: ScorerConfig[];
};

export type SuiteFile = {
  name: string;
  version?: number;
  defaults?: {
    model?: string;
    feature_id?: string;
    timeout_ms?: number;
    scorers?: ScorerConfig[];
  };
  cases: SuiteCase[];
};

export type CaseResult = {
  case_id: string;
  feature_id?: string;
  passed: boolean;
  cost_usd: number;
  latency_ms: number;
  failure_reason?: string;
  scorer_results: Array<{ type: string; passed: boolean; message?: string }>;
};

export type EvalRunResult = {
  suite: string;
  pass_rate: number;
  avg_cost_usd: number;
  p95_latency_ms: number;
  total_cases: number;
  passed_cases: number;
  cases: CaseResult[];
  git_sha?: string;
  pr_number?: number;
  git_ref?: string;
};
