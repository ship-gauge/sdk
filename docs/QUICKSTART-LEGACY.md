# ShipGauge Quickstart (5 minutes)

Get cost tracking + eval gate running on a side project.

## 1. Create a project

1. Run `pnpm dev` and open [http://localhost:3000](http://localhost:3000)
2. Sign up at `/login`
3. Create a project at `/onboarding` — **save your `sg_ingest_*` API key**

## 2. Install SDK (Node or Python)

### Node.js

```bash
pnpm add @shipgauge/node
```

```typescript
import { ShipGauge } from "@shipgauge/node";
import OpenAI from "openai";

const sg = ShipGauge.init({
  apiKey: process.env.SHIPGAUGE_API_KEY!,
  projectId: process.env.SHIPGAUGE_PROJECT_ID!,
  baseUrl: "http://localhost:3000",
});

const openai = sg.wrapOpenAI(new OpenAI(), {
  defaultTags: { feature_id: "chat" },
});
```

### Python

```bash
pip install -e packages/python
```

```python
from shipgauge import ShipGauge
from openai import OpenAI

sg = ShipGauge(
    api_key="sg_ingest_...",
    project_id="your-project-uuid",
    base_url="http://localhost:3000",
)
client = sg.wrap_openai(OpenAI(), default_feature_id="chat")
```

## 3. Send a test event

```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H "Authorization: Bearer sg_ingest_..." \
  -H "Content-Type: application/json" \
  -d '{"events":[{"feature_id":"chat","model":"gpt-4o-mini","input_tokens":500,"output_tokens":120}]}'
```

View spend at `/projects/{id}/overview`.

## 4. Run smoke eval locally

```bash
pnpm install
pnpm --filter @shipgauge/cli build

shipgauge init
# Edit .shipgauge/config.yml with api_key + project_id

pnpm eval:smoke
# Or: node packages/cli/dist/index.js eval --suite smoke --no-upload
```

Copy `examples/suites/smoke.yaml` or use `suites_dir: examples/suites` in config.

## 5. Gate check (CI)

```bash
# First run establishes baseline; subsequent runs compare
node packages/cli/dist/index.js gate check --suite smoke --no-upload
```

Gate rules live in `.shipgauge/gate.yml`:

```yaml
rules:
  pass_rate:
    min: 0.95
    max_drop: 0.05
  avg_cost_usd:
    max_increase: 0.20
  fail_on_any_case: true
```

## 6. GitHub Action

Add secrets: `SHIPGAUGE_API_KEY`, `SHIPGAUGE_PROJECT_ID`

```yaml
# .github/workflows/shipgauge.yml
name: ShipGauge Gate
on: [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: ./packages/action
        with:
          api-key: ${{ secrets.SHIPGAUGE_API_KEY }}
          project-id: ${{ secrets.SHIPGAUGE_PROJECT_ID }}
          suite: smoke
          suites-dir: examples/suites
          base-url: https://your-app.vercel.app
```

The action runs `shipgauge gate check`, posts a **PR comment** with pass rate / cost / latency deltas, and fails the job if the gate blocks.

## What you should see

| Step | Result |
|------|--------|
| First event | $ amount on Overview |
| First eval | 100% pass on smoke suite |
| First gate | Baseline established |
| PR with Action | Comment: `ShipGauge Gate — ✅ Passed` |

## Next

- Set budget rules at `/projects/{id}/budget`
- View eval runs at `/projects/{id}/evals`
- View gate history at `/projects/{id}/gates`
