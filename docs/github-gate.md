---
title: GitHub Gate (required check)
---

ShipGauge posts a GitHub check run named **ShipGauge Gate**.

## Enable required status

1. Workflow needs `permissions: checks: write`
2. Branch protection → require status check **ShipGauge Gate**

## Bypass

Set `bypass_label` in `.shipgauge/gate.yml` (default `shipgauge-skip`).

See [GITHUB-GATE.md](https://github.com/harper-dev/ship-gauge/blob/main/docs/GITHUB-GATE.md) for full setup.
