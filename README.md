# ShipGauge SDK

> Open-source client tooling for [ShipGauge](https://shipgauge.dev) — the pre-ship gate for indie AI.

MIT-licensed packages for cost tracking, eval suites, and CI gates. The hosted dashboard at [app.shipgauge.dev](https://app.shipgauge.dev) is proprietary SaaS.

## Packages

| Package | Install | Description |
|---------|---------|-------------|
| `@shipgauge/node` | `npm i @shipgauge/node` | Node.js SDK — `wrapOpenAI`, budget guardrails |
| `@shipgauge/cli` | `npm i -g @shipgauge/cli` | Eval + gate CLI for CI |
| `@shipgauge/scorers` | `npm i @shipgauge/scorers` | Shared scorer engine |
| `shipgauge` (Python) | `pip install shipgauge` | Python SDK |

## Quick start

```bash
npm i @shipgauge/node
```

```ts
import { ShipGauge } from "@shipgauge/node";

const sg = ShipGauge.init({
  apiKey: process.env.SHIPGAUGE_API_KEY!,
  projectId: process.env.SHIPGAUGE_PROJECT_ID!,
});

const openai = sg.wrapOpenAI(new OpenAI());
```

## CI gate

```yaml
- uses: ship-gauge/action@v1
  with:
    api-key: ${{ secrets.SHIPGAUGE_API_KEY }}
    project-id: ${{ secrets.SHIPGAUGE_PROJECT_ID }}
    suite: smoke
```

See [docs/quickstart.md](docs/quickstart.md) and [docs/github-gate.md](docs/github-gate.md).

## Monorepo scripts

```bash
pnpm install
pnpm build
pnpm test
```

## Related repos

| Repo | License |
|------|---------|
| [ship-gauge/sdk](https://github.com/ship-gauge/sdk) | MIT (this repo) |
| [ship-gauge/action](https://github.com/ship-gauge/action) | MIT |
| [shipgauge/app](https://app.shipgauge.dev) | Proprietary SaaS |

## License

MIT — see [LICENSE](LICENSE). Hosted ShipGauge API and dashboard are not covered by this license.
