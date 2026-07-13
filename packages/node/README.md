# @shipgauge/node

Node.js SDK for [ShipGauge](https://shipgauge.dev) — per-feature LLM cost tracking and production budget guardrails.

Metadata only: **prompts and completions are never sent to ShipGauge.**

## Install

```bash
npm i @shipgauge/node
```

## Quick start

```ts
import OpenAI from "openai";
import { ShipGauge } from "@shipgauge/node";

const sg = ShipGauge.init({
  apiKey: process.env.SHIPGAUGE_API_KEY!,
  projectId: process.env.SHIPGAUGE_PROJECT_ID!,
  baseUrl: "https://app.shipgauge.dev",
});

const openai = sg.wrapOpenAI(new OpenAI(), { defaultFeatureId: "chat" });

const res = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Features

- `wrapOpenAI()` / `wrapAnthropic()` — auto token + cost metadata
- `record()` — manual event ingest
- `configureBudget()` — handle hard budget blocks (429) in your app
- `configurePricing()` — override model price table
- OTel export — optional `otel: { endpoint }` in `init()`

## Environment

| Variable | Description |
|----------|-------------|
| `SHIPGAUGE_API_KEY` | Ingest key (`sg_ingest_...`) |
| `SHIPGAUGE_PROJECT_ID` | Project UUID |

## Links

- [Quickstart](https://shipgauge.dev/docs/quickstart)
- [Budget rules](https://shipgauge.dev/docs/budget)
- [SDK monorepo](https://github.com/ship-gauge/sdk)

## License

MIT
