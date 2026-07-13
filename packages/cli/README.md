# @shipgauge/cli

CLI for [ShipGauge](https://shipgauge.dev) — run eval suites locally or in CI, compare against baselines, and enforce ship gates.

## Install

```bash
npm i -g @shipgauge/cli
```

## Commands

```bash
shipgauge init                     # .shipgauge/config.yml + smoke suite
shipgauge doctor                   # validate local setup
shipgauge eval --suite smoke       # run eval (exit 0 = pass)
shipgauge gate check --suite smoke # CI gate vs baseline
shipgauge budget status            # budget rules + spend (needs API key)
```

## CI (GitHub Actions)

```yaml
- uses: ship-gauge/action@v1
  with:
    api-key: ${{ secrets.SHIPGAUGE_API_KEY }}
    project-id: ${{ secrets.SHIPGAUGE_PROJECT_ID }}
    suite: smoke
    cli-version: "0.1.0"
```

## Config

`.shipgauge/config.yml`:

```yaml
api_key: sg_ingest_...
project_id: your-project-uuid
base_url: https://app.shipgauge.dev
suites_dir: suites
```

Gate thresholds: `.shipgauge/gate.yml` (see [gate docs](https://shipgauge.dev/docs/gate)).

## Links

- [Quickstart](https://shipgauge.dev/docs/quickstart)
- [GitHub gate](https://shipgauge.dev/docs/github-gate)
- [SDK monorepo](https://github.com/ship-gauge/sdk)

## License

MIT
