# GitHub Required Status Check

ShipGauge creates a check run named **ShipGauge Gate** that you can require before merging.

## 1. Workflow permissions

Your GitHub Actions workflow must grant `checks: write`:

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
```

The composite action passes `--status-check` by default.

## 2. Enable branch protection

1. **Repository → Settings → Branches → Branch protection rules**
2. Add rule for `main` (or your default branch)
3. Enable **Require status checks to pass before merging**
4. Search and select **ShipGauge Gate**
5. Save

PRs cannot merge until the check reports `success`.

## PR comments

The CLI **updates** an existing ShipGauge comment on re-runs instead of posting duplicates. Comments include a hidden marker `<!-- shipgauge-gate -->` for idempotent upsert via the GitHub Issues API.

Requires `pull-requests: write` (already in the sample workflow).

## 3. Bypass label

Configure in `.shipgauge/gate.yml`:

```yaml
bypass_label: shipgauge-skip
```

Add that label to a PR to mark the gate as passed (check run still succeeds with bypass note).

## 4. First run / baseline

On the first CI run without a baseline, ShipGauge saves the current eval as baseline and posts a **success** check run.

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| Check never appears | Add `checks: write` to workflow `permissions` |
| Check not required | Add **ShipGauge Gate** in branch protection |
| `Failed to create required check run` | Verify `GITHUB_TOKEN` and `GITHUB_SHA` in the job |
| PR comment missing | Normal on non-PR events; comments need `pull-requests: write` |

Check name is exactly **`ShipGauge Gate`** (case-sensitive in branch protection UI).
