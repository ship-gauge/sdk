# Next.js + OpenAI + ShipGauge

Minimal example: one API route that wraps OpenAI with ShipGauge cost tracking and `feature_id` tagging.

## Setup

1. Copy env and fill in your keys:

```bash
cp .env.example .env.local
```

2. Install dependencies (from monorepo root):

```bash
pnpm install
```

Or standalone:

```bash
npm install @shipgauge/node openai next react react-dom
```

3. Run ShipGauge locally (`pnpm dev` from repo root) or point `SHIPGAUGE_BASE_URL` at your hosted project.

4. Start the example:

```bash
pnpm dev
```

5. Send a test request:

```bash
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in one word"}'
```

6. Open your ShipGauge project **Overview** — you should see spend under feature `chat`.

## Files

| File | Purpose |
|------|---------|
| `app/api/chat/route.ts` | OpenAI call wrapped with `ShipGauge.wrapOpenAI` |
| `.shipgauge/config.yml.example` | CLI config template for eval/gate |
| `suites/smoke.yaml` | Symlink to `../../suites/smoke.yaml` for CI gate |

## CI gate

```yaml
- uses: harper-dev/ship-gauge/packages/action@main
  with:
    api-key: ${{ secrets.SHIPGAUGE_API_KEY }}
    project-id: ${{ secrets.SHIPGAUGE_PROJECT_ID }}
    base-url: https://app.shipgauge.dev
    suites-dir: examples/suites
```

After `@shipgauge/cli` is on npm:

```yaml
- uses: ship-gauge/action@v1
  with:
    api-key: ${{ secrets.SHIPGAUGE_API_KEY }}
    project-id: ${{ secrets.SHIPGAUGE_PROJECT_ID }}
```
