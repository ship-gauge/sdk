---
title: OpenTelemetry export
---

The Node SDK can emit LLM spans to any OTLP/HTTP JSON collector (best-effort, non-blocking).

```typescript
import { ShipGauge } from "@shipgauge/node";

const sg = ShipGauge.init({
  apiKey: process.env.SHIPGAUGE_API_KEY!,
  projectId: process.env.SHIPGAUGE_PROJECT_ID!,
  otel: {
    endpoint: "https://otel-collector.example/v1/traces",
    serviceName: "my-app",
    headers: { Authorization: "Bearer token" },
  },
});

await sg.record({
  feature_id: "chat",
  model: "gpt-4o-mini",
  input_tokens: 100,
  output_tokens: 50,
});
```

Span name: `llm.{feature_id}`. Attributes include `llm.model`, `llm.cost_usd`, `llm.input_tokens`, `llm.output_tokens`, and optional `llm.latency_ms`.
