export type ScorerConfig =
  | { type: "contains"; value: string; case_insensitive?: boolean }
  | { type: "not_contains"; value: string; case_insensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json_schema"; schema: Record<string, unknown> }
  | { type: "latency_max_ms"; max: number }
  | { type: "cost_max_usd"; max: number }
  | { type: "llm_judge"; rubric: string; case_insensitive?: boolean }
  | { type: "similarity"; reference: string; min_score: number; case_insensitive?: boolean }
  | { type: "custom_ref"; name: string }
  | { type: "http"; url: string; method?: string };

export type ScorerContext = {
  output: string;
  latencyMs: number;
  costUsd: number;
  caseId?: string;
};

export type ScorerResult = {
  type: string;
  passed: boolean;
  message?: string;
};

export type RunScorersOptions = {
  customScorers?: Record<string, ScorerConfig[]>;
};
