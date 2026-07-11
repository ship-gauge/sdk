import { exportLlmSpan, type OtelExporterConfig } from "./otel.js";

export type { OtelExporterConfig };
export { exportLlmSpan };

export type BudgetBlockError = {
  error: "budget_exceeded";
  feature: string;
  limit_usd: number;
  spent_usd: number;
  resets_at: string;
};

type BudgetSdkConfig = {
  throwOnBlock: boolean;
  onBlock?: (error: BudgetBlockError) => void;
};

let budgetSdkConfig: BudgetSdkConfig = { throwOnBlock: true };

export function configureBudget(config: {
  throwOnBlock?: boolean;
  onBlock?: (error: BudgetBlockError) => void;
}): void {
  budgetSdkConfig = {
    throwOnBlock: config.throwOnBlock ?? true,
    onBlock: config.onBlock,
  };
}

export function resetBudget(): void {
  budgetSdkConfig = { throwOnBlock: true };
}

async function handleIngestFailure(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;

  const error = (await response.json().catch(() => ({}))) as Partial<BudgetBlockError>;
  if (error.error === "budget_exceeded") {
    const blockError = error as BudgetBlockError;
    budgetSdkConfig.onBlock?.(blockError);
    if (!budgetSdkConfig.throwOnBlock) return true;
    throw new Error(
      `ShipGauge budget exceeded for ${blockError.feature}: ${blockError.spent_usd}/${blockError.limit_usd} USD`,
    );
  }
  return false;
}

export type ShipGaugeConfig = {
  apiKey: string;
  projectId: string;
  environment?: string;
  baseUrl?: string;
  otel?: OtelExporterConfig;
};

export type RecordInput = {
  feature_id: string;
  model: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  latency_ms?: number;
  environment?: string;
  user_id_hash?: string;
  customer_id?: string;
  deployment?: string;
  metadata?: Record<string, unknown>;
};

const PRICING: Record<string, { input: number; output: number; provider: string }> = {
  "gpt-4o": { input: 2.5, output: 10, provider: "openai" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, provider: "openai" },
  "gpt-4.1": { input: 2.0, output: 8.0, provider: "openai" },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, provider: "openai" },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, provider: "anthropic" },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0, provider: "anthropic" },
};

export function configurePricing(
  overrides: Record<string, { input: number; output: number; provider?: string }>,
): void {
  for (const [model, pricing] of Object.entries(overrides)) {
    PRICING[model] = {
      input: pricing.input,
      output: pricing.output,
      provider: pricing.provider ?? "custom",
    };
  }
}

function calculateCost(model: string, inputTokens: number, outputTokens: number) {
  const pricing = PRICING[model];
  if (!pricing) return { cost: 0, provider: "unknown" };
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return { cost: Number(cost.toFixed(6)), provider: pricing.provider };
}

export class ShipGauge {
  private config: Required<Omit<ShipGaugeConfig, "otel">> & { otel?: OtelExporterConfig };

  private constructor(config: ShipGaugeConfig) {
    this.config = {
      environment: "production",
      baseUrl: "http://localhost:3000",
      ...config,
    };
  }

  static init(config: ShipGaugeConfig): ShipGauge {
    return new ShipGauge(config);
  }

  async record(event: RecordInput): Promise<{ cost_usd: number }> {
    const { cost, provider } = calculateCost(
      event.model,
      event.input_tokens,
      event.output_tokens,
    );

    if (this.config.otel) {
      void exportLlmSpan(this.config.otel, {
        featureId: event.feature_id,
        model: event.model,
        provider: event.provider ?? provider,
        inputTokens: event.input_tokens,
        outputTokens: event.output_tokens,
        costUsd: cost,
        latencyMs: event.latency_ms,
        environment: event.environment ?? this.config.environment,
        projectId: this.config.projectId,
      });
    }

    const response = await fetch(`${this.config.baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [
          {
            ...event,
            environment: event.environment ?? this.config.environment,
          },
        ],
      }),
    });

    if (!response.ok) {
      if (await handleIngestFailure(response)) {
        return { cost_usd: 0 };
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `ShipGauge ingest failed (${response.status}): ${JSON.stringify(error)}`,
      );
    }

    const data = (await response.json()) as { cost_usd: number };
    return { cost_usd: data.cost_usd };
  }

  async recordBatch(events: RecordInput[]): Promise<{ accepted: number; cost_usd: number }> {
    if (!events.length) return { accepted: 0, cost_usd: 0 };

    const response = await fetch(`${this.config.baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: events.map((event) => ({
          ...event,
          environment: event.environment ?? this.config.environment,
        })),
      }),
    });

    if (!response.ok) {
      if (await handleIngestFailure(response)) {
        return { accepted: 0, cost_usd: 0 };
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `ShipGauge batch ingest failed (${response.status}): ${JSON.stringify(error)}`,
      );
    }

    const data = (await response.json()) as { accepted?: number; cost_usd?: number };
    return {
      accepted: data.accepted ?? events.length,
      cost_usd: data.cost_usd ?? 0,
    };
  }

  async getBudgetStatus(): Promise<{
    project_id: string;
    rules: Array<{
      id: string;
      scope: string;
      scope_id: string | null;
      limit_usd: number;
      spent_usd: number;
      used_pct: number;
      period: string;
    }>;
    override: { limit_multiplier: number; expires_at: string } | null;
  }> {
    const response = await fetch(`${this.config.baseUrl}/api/v1/budget-status`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `ShipGauge budget status failed (${response.status}): ${JSON.stringify(error)}`,
      );
    }

    return response.json() as Promise<{
      project_id: string;
      rules: Array<{
        id: string;
        scope: string;
        scope_id: string | null;
        limit_usd: number;
        spent_usd: number;
        used_pct: number;
        period: string;
      }>;
      override: { limit_multiplier: number; expires_at: string } | null;
    }>;
  }

  wrapOpenAI<T extends object>(
    client: T,
    options?: { defaultTags?: { feature_id?: string } },
  ): T {
    const sg = this;
    const defaultFeature = options?.defaultTags?.feature_id ?? "default";

    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "chat" || typeof value !== "object" || value === null) {
          return typeof value === "function" ? value.bind(target) : value;
        }

        return new Proxy(value as object, {
          get(chatTarget, chatProp, chatReceiver) {
            const chatValue = Reflect.get(chatTarget, chatProp, chatReceiver);
            if (chatProp !== "completions" || typeof chatValue !== "object") {
              return typeof chatValue === "function"
                ? chatValue.bind(chatTarget)
                : chatValue;
            }

            return new Proxy(chatValue as object, {
              get(completionsTarget, completionsProp, completionsReceiver) {
                const create = Reflect.get(
                  completionsTarget,
                  completionsProp,
                  completionsReceiver,
                );
                if (completionsProp !== "create" || typeof create !== "function") {
                  return create;
                }

                return async (...args: unknown[]) => {
                  const started = Date.now();
                  const result = await create.apply(completionsTarget, args);
                  const usage = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }).usage;
                  const model =
                    (result as { model?: string }).model ??
                    (args[0] as { model?: string })?.model ??
                    "gpt-4o-mini";

                  await sg.record({
                    feature_id: defaultFeature,
                    model,
                    input_tokens: usage?.prompt_tokens ?? 0,
                    output_tokens: usage?.completion_tokens ?? 0,
                    latency_ms: Date.now() - started,
                    metadata: extractOutputSampleMetadata(result),
                  });

                  return result;
                };
              },
            });
          },
        });
      },
    });
  }

  wrapAnthropic<T extends object>(
    client: T,
    options?: { defaultTags?: { feature_id?: string } },
  ): T {
    const sg = this;
    const defaultFeature = options?.defaultTags?.feature_id ?? "default";

    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "messages" || typeof value !== "object" || value === null) {
          return typeof value === "function" ? value.bind(target) : value;
        }

        return new Proxy(value as object, {
          get(messagesTarget, messagesProp, messagesReceiver) {
            const create = Reflect.get(messagesTarget, messagesProp, messagesReceiver);
            if (messagesProp !== "create" || typeof create !== "function") {
              return typeof create === "function"
                ? create.bind(messagesTarget)
                : create;
            }

            return async (...args: unknown[]) => {
              const started = Date.now();
              const result = await create.apply(messagesTarget, args);
              const usage = (result as {
                usage?: { input_tokens?: number; output_tokens?: number };
                model?: string;
              }).usage;
              const model =
                (result as { model?: string }).model ??
                (args[0] as { model?: string })?.model ??
                "claude-3-5-haiku-20241022";

              await sg.record({
                feature_id: defaultFeature,
                model,
                provider: "anthropic",
                input_tokens: usage?.input_tokens ?? 0,
                output_tokens: usage?.output_tokens ?? 0,
                latency_ms: Date.now() - started,
                metadata: extractAnthropicOutputSample(result),
              });

              return result;
            };
          },
        });
      },
    });
  }

  wrapCompatible<T extends object>(
    client: T,
    options?: {
      path?: string[];
      defaultTags?: { feature_id?: string };
    },
  ): T {
    const path = options?.path ?? ["chat", "completions", "create"];
    const sg = this;
    const defaultFeature = options?.defaultTags?.feature_id ?? "default";

    const wrapAt = (target: object, segments: string[]): object => {
      if (segments.length === 0) return target;
      const [head, ...rest] = segments;
      return new Proxy(target, {
        get(proxyTarget, prop, receiver) {
          const value = Reflect.get(proxyTarget, prop, receiver);
          if (prop !== head) {
            return typeof value === "function" ? value.bind(proxyTarget) : value;
          }
          if (rest.length === 0 && typeof value === "function") {
            return async (...args: unknown[]) => {
              const started = Date.now();
              const result = await value.apply(proxyTarget, args);
              const usage = (result as {
                usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
                model?: string;
              }).usage;
              const model =
                (result as { model?: string }).model ??
                (args[0] as { model?: string })?.model ??
                "gpt-4o-mini";

              await sg.record({
                feature_id: defaultFeature,
                model,
                input_tokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
                output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
                latency_ms: Date.now() - started,
                metadata: extractOutputSampleMetadata(result),
              });

              return result;
            };
          }
          if (typeof value === "object" && value !== null) {
            return wrapAt(value as object, rest);
          }
          return typeof value === "function" ? value.bind(proxyTarget) : value;
        },
      });
    };

    return wrapAt(client, path) as T;
  }
}

export function calculateEventCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  return calculateCost(model, inputTokens, outputTokens);
}

const OUTPUT_SAMPLE_MAX = 280;

function truncateOutputSample(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, OUTPUT_SAMPLE_MAX);
}

function extractOutputSampleMetadata(result: unknown): Record<string, unknown> | undefined {
  const content = (result as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return { output_sample: truncateOutputSample(content) };
  }
  return undefined;
}

function extractAnthropicOutputSample(result: unknown): Record<string, unknown> | undefined {
  const blocks = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = blocks?.find((b) => b.type === "text")?.text;
  if (text?.trim()) {
    return { output_sample: truncateOutputSample(text) };
  }
  return undefined;
}
