---
title: Margin & StackLedger
description: Map customer MRR to LLM cost and export for accounting.
---

# Margin view

Pro and Team plans include **customer-level cost** and **margin**:

1. Send `customer_id` in SDK events.
2. Open **Margin** and map each `customer_id` to monthly MRR (USD).
3. Compare gross margin = MRR − LLM spend (30d rolling).

## StackLedger

Set **StackLedger project ID** under Settings → Integrations. When `STACKLEDGER_API_URL` and `STACKLEDGER_API_KEY` are configured, the Margin page pulls subscription burn and merges with ShipGauge LLM cost.

Export a Schedule C–friendly CSV:

```
GET /api/projects/{projectId}/export?type=stackledger
```

## Team RBAC

Team plan members with role `member` have read-only dashboard access. Admins manage billing, invites, integrations, and project settings.
