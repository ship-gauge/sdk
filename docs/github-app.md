---
title: GitHub App sync
---

Prefer **Register GitHub App (one-click)** then **Install GitHub App** over PATs.

1. Manifest: `GET /api/github/app/manifest`
2. Register: `GET /api/github/app/register?project_id=...`
3. Webhook: `POST /api/webhooks/github` with `push` + `installation` events

See [GITHUB-APP.md](https://github.com/harper-dev/ship-gauge/blob/main/docs/GITHUB-APP.md).
