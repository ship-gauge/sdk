# @shipgauge/scorers

Eval scorer engine for [ShipGauge](https://shipgauge.dev) — used by `@shipgauge/cli` and custom eval suites.

## Install

```bash
npm i @shipgauge/scorers
```

Usually you use scorers via the CLI or YAML suites; install this package when building custom tooling.

## Built-in scorers

| Type | Description |
|------|-------------|
| `contains` | Output includes substring |
| `not_contains` | Output excludes substring |
| `regex` | Output matches pattern |
| `json_schema` | Output validates against JSON Schema |
| `latency_max_ms` | Case latency under threshold |
| `cost_max_usd` | Case cost under threshold |
| `llm_judge` | Rubric phrase checks |
| `custom_ref` | Project-defined scorer (hosted dashboard) |
| `http` | HTTP callback scorer |

## Example (suite YAML)

```yaml
cases:
  - id: smoke-1
    input: "Hello"
    scorers:
      - type: contains
        value: "Hi"
      - type: cost_max_usd
        max: 0.01
```

## Links

- [ShipGauge docs](https://shipgauge.dev/docs/quickstart)
- [SDK monorepo](https://github.com/ship-gauge/sdk)

## License

MIT
