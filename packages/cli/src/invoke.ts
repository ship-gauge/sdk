const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

export function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return Number(cost.toFixed(6));
}

export type InvokeResult = {
  output: string;
  latency_ms: number;
  cost_usd: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
};

export async function invokeCase(
  invoke: NonNullable<import("./types.js").SuiteCase["invoke"]>,
  model: string,
  timeoutMs: number,
): Promise<InvokeResult> {
  const started = Date.now();

  if (invoke.type === "mock") {
    await sleep(invoke.latency_ms ?? 10);
    return {
      output: invoke.output,
      latency_ms: invoke.latency_ms ?? Date.now() - started,
      cost_usd: invoke.cost_usd ?? 0,
      model,
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  if (invoke.type === "template") {
    await sleep(5);
    return {
      output: invoke.template,
      latency_ms: Date.now() - started,
      cost_usd: 0,
      model,
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  if (invoke.type === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required for openai invoke cases. Use invoke.type: mock for offline runs.",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: invoke.model ?? model,
          messages: invoke.messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${err}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };

      const output = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const usedModel = data.model ?? invoke.model ?? model;

      return {
        output,
        latency_ms: Date.now() - started,
        cost_usd: calculateCostUsd(usedModel, inputTokens, outputTokens),
        model: usedModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (invoke.type === "http") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(invoke.url, {
        method: invoke.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...(invoke.headers ?? {}),
        },
        body: invoke.body != null ? JSON.stringify(invoke.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HTTP invoke error (${response.status}): ${err}`);
      }

      const text = await response.text();
      let output = text;
      if (invoke.json_path) {
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          output = String(json[invoke.json_path] ?? text);
        } catch {
          output = text;
        }
      }

      return {
        output,
        latency_ms: invoke.latency_ms ?? Date.now() - started,
        cost_usd: invoke.cost_usd ?? 0,
        model,
        input_tokens: 0,
        output_tokens: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Unknown invoke type`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
