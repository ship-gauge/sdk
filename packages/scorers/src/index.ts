import type { ScorerConfig, ScorerContext, ScorerResult, RunScorersOptions } from "./types.js";

export type { ScorerConfig, ScorerContext, ScorerResult, RunScorersOptions };

function tokenize(text: string, caseInsensitive: boolean): string[] {
  const normalized = caseInsensitive ? text.toLowerCase() : text;
  return normalized.match(/[a-z0-9]+/gi) ?? [];
}

function cosineSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();
  for (const token of a) freqA.set(token, (freqA.get(token) ?? 0) + 1);
  for (const token of b) freqB.set(token, (freqB.get(token) ?? 0) + 1);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [token, count] of freqA) {
    normA += count * count;
    const other = freqB.get(token) ?? 0;
    dot += count * other;
  }
  for (const count of freqB.values()) normB += count * count;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function runContains(
  output: string,
  value: string,
  caseInsensitive: boolean,
  negate: boolean,
): ScorerResult {
  const haystack = caseInsensitive ? output.toLowerCase() : output;
  const needle = caseInsensitive ? value.toLowerCase() : value;
  const found = haystack.includes(needle);
  const passed = negate ? !found : found;
  return {
    type: negate ? "not_contains" : "contains",
    passed,
    message: passed
      ? undefined
      : negate
        ? `Output contains forbidden value "${value}"`
        : `Output does not contain "${value}"`,
  };
}

function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
): boolean {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const obj = value as Record<string, unknown>;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) return false;
    }
    const properties = schema.properties as
      | Record<string, { type?: string }>
      | undefined;
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj && propSchema.type) {
          if (typeof obj[key] !== propSchema.type) return false;
        }
      }
    }
    return true;
  }
  if (schema.type && typeof value !== schema.type) {
    return false;
  }
  return true;
}

export function runScorer(
  scorer: ScorerConfig,
  context: ScorerContext,
): ScorerResult {
  switch (scorer.type) {
    case "contains":
      return runContains(
        context.output,
        scorer.value,
        scorer.case_insensitive ?? false,
        false,
      );
    case "not_contains":
      return runContains(
        context.output,
        scorer.value,
        scorer.case_insensitive ?? false,
        true,
      );
    case "regex": {
      const flags = scorer.flags ?? "";
      const re = new RegExp(scorer.pattern, flags);
      const passed = re.test(context.output);
      return {
        type: "regex",
        passed,
        message: passed ? undefined : `Output does not match /${scorer.pattern}/${flags}`,
      };
    }
    case "json_schema": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(context.output);
      } catch {
        return {
          type: "json_schema",
          passed: false,
          message: "Output is not valid JSON",
        };
      }
      const passed = validateJsonSchema(parsed, scorer.schema);
      return {
        type: "json_schema",
        passed,
        message: passed ? undefined : "Output JSON does not match schema",
      };
    }
    case "latency_max_ms": {
      const passed = context.latencyMs <= scorer.max;
      return {
        type: "latency_max_ms",
        passed,
        message: passed
          ? undefined
          : `Latency ${context.latencyMs}ms exceeds max ${scorer.max}ms`,
      };
    }
    case "cost_max_usd": {
      const passed = context.costUsd <= scorer.max;
      return {
        type: "cost_max_usd",
        passed,
        message: passed
          ? undefined
          : `Cost $${context.costUsd.toFixed(6)} exceeds max $${scorer.max}`,
      };
    }
    case "llm_judge": {
      const phrases = scorer.rubric
        .split(/[.;]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const haystack = scorer.case_insensitive
        ? context.output.toLowerCase()
        : context.output;
      const missing = phrases.filter((phrase) => {
        const needle = scorer.case_insensitive ? phrase.toLowerCase() : phrase;
        return !haystack.includes(needle);
      });
      const passed = missing.length === 0;
      return {
        type: "llm_judge",
        passed,
        message: passed
          ? undefined
          : `Rubric not met: missing "${missing[0]}"`,
      };
    }
    case "similarity": {
      const score = cosineSimilarity(
        tokenize(context.output, scorer.case_insensitive ?? false),
        tokenize(scorer.reference, scorer.case_insensitive ?? false),
      );
      const passed = score >= scorer.min_score;
      return {
        type: "similarity",
        passed,
        message: passed
          ? undefined
          : `Similarity ${score.toFixed(3)} below min ${scorer.min_score}`,
      };
    }
    case "custom_ref":
      return {
        type: "custom_ref",
        passed: false,
        message: `Custom scorer "${scorer.name}" must be resolved via runScorersAsync`,
      };
    case "http":
      return {
        type: "http",
        passed: false,
        message: "HTTP scorer must be run via runScorersAsync",
      };
    default: {
      const unknown = scorer as { type: string };
      return {
        type: unknown.type,
        passed: false,
        message: `Unknown scorer type: ${unknown.type}`,
      };
    }
  }
}

async function runHttpScorer(
  scorer: Extract<ScorerConfig, { type: "http" }>,
  context: ScorerContext,
): Promise<ScorerResult> {
  try {
    const response = await fetch(scorer.url, {
      method: scorer.method ?? "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
    if (!response.ok) {
      return {
        type: "http",
        passed: false,
        message: `HTTP scorer returned ${response.status}`,
      };
    }
    const body = (await response.json()) as { passed?: boolean; message?: string };
    return {
      type: "http",
      passed: Boolean(body.passed),
      message: body.passed ? undefined : body.message ?? "HTTP scorer failed",
    };
  } catch (error) {
    return {
      type: "http",
      passed: false,
      message: error instanceof Error ? error.message : "HTTP scorer request failed",
    };
  }
}

export async function runScorersAsync(
  scorers: ScorerConfig[],
  context: ScorerContext,
  options?: RunScorersOptions,
): Promise<ScorerResult[]> {
  const results: ScorerResult[] = [];

  for (const scorer of scorers) {
    if (scorer.type === "custom_ref") {
      const defs = options?.customScorers?.[scorer.name];
      if (!defs?.length) {
        results.push({
          type: "custom_ref",
          passed: false,
          message: `Custom scorer "${scorer.name}" not found`,
        });
        continue;
      }
      const nested = await runScorersAsync(defs, context, options);
      results.push(...nested);
      continue;
    }

    if (scorer.type === "http") {
      results.push(await runHttpScorer(scorer, context));
      continue;
    }

    results.push(runScorer(scorer, context));
  }

  return results;
}

export function runScorers(
  scorers: ScorerConfig[],
  context: ScorerContext,
  options?: RunScorersOptions,
): ScorerResult[] {
  const results: ScorerResult[] = [];

  for (const scorer of scorers) {
    if (scorer.type === "custom_ref") {
      const defs = options?.customScorers?.[scorer.name];
      if (!defs?.length) {
        results.push({
          type: "custom_ref",
          passed: false,
          message: `Custom scorer "${scorer.name}" not found`,
        });
        continue;
      }
      results.push(...runScorers(defs, context, options));
      continue;
    }

    if (scorer.type === "http") {
      results.push({
        type: "http",
        passed: false,
        message: "HTTP scorer requires runScorersAsync",
      });
      continue;
    }

    results.push(runScorer(scorer, context));
  }

  return results;
}

export function allScorersPassed(results: ScorerResult[]): boolean {
  return results.every((r) => r.passed);
}
