export type OtelExporterConfig = {
  endpoint: string;
  serviceName?: string;
  headers?: Record<string, string>;
};

export type LlmSpanInput = {
  featureId: string;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs?: number;
  environment?: string;
  projectId?: string;
};

function hexTraceId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function hexSpanId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** Minimal OTLP/HTTP JSON span export (no SDK dependency). */
export async function exportLlmSpan(
  config: OtelExporterConfig,
  span: LlmSpanInput,
): Promise<void> {
  const nowNanos = String(Date.now() * 1_000_000);
  const serviceName = config.serviceName ?? "shipgauge";

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            ...(span.projectId
              ? [{ key: "shipgauge.project_id", value: { stringValue: span.projectId } }]
              : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "shipgauge.node" },
            spans: [
              {
                traceId: hexTraceId(),
                spanId: hexSpanId(),
                name: `llm.${span.featureId}`,
                kind: 1,
                startTimeUnixNano: nowNanos,
                endTimeUnixNano: nowNanos,
                attributes: [
                  { key: "llm.model", value: { stringValue: span.model } },
                  { key: "llm.provider", value: { stringValue: span.provider ?? "unknown" } },
                  { key: "llm.input_tokens", value: { intValue: span.inputTokens } },
                  { key: "llm.output_tokens", value: { intValue: span.outputTokens } },
                  { key: "llm.cost_usd", value: { doubleValue: span.costUsd } },
                  ...(span.latencyMs != null
                    ? [{ key: "llm.latency_ms", value: { intValue: span.latencyMs } }]
                    : []),
                  ...(span.environment
                    ? [{ key: "deployment.environment", value: { stringValue: span.environment } }]
                    : []),
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // OTel export is best-effort; never block ingest
  }
}
