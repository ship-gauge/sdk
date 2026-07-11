# GitHub App (suite sync)

Replace long-lived PATs with a GitHub App that mints short-lived installation tokens.

## Option A — One-click Manifest registration (recommended)

No manual GitHub Developer Settings required.

1. **Project → Settings → Integrations**
2. Click **Register GitHub App (one-click)**
3. Approve creation on GitHub — ShipGauge stores `app_id`, private key, slug, and webhook secret on your **workspace** (`organizations.settings_json.github_app`)
4. Click **Install GitHub App** and select the repository
5. Enter `owner` / `repo` / branch / suites path, then pull or rely on webhooks

Manifest URL (GitHub fetches this): `GET /api/github/app/manifest`

Registration redirect: `GET /api/github/app/register?project_id=...`

Credentials are encrypted with `INTEGRATION_SECRETS_KEY` when set.

## Option B — Manual GitHub App

In **GitHub → Settings → Developer settings → GitHub Apps → New**:

| Field | Value |
|-------|--------|
| Homepage URL | `https://YOUR_APP_URL` |
| Setup URL | `https://YOUR_APP_URL/api/github/app/callback` |
| Webhook URL | `https://YOUR_APP_URL/api/webhooks/github` |
| Webhook secret | Generate and save as `GITHUB_WEBHOOK_SECRET` |
| Permissions | **Contents**: Read & write |
| Events | `push`, `installation` |
| Where | Any account / Only on this account |

Generate a **private key** and note the **App ID** and **slug** (from the public page URL).

## 2. Environment

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_SLUG=shipgauge
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

## 3. Connect in ShipGauge

1. **Project → Settings → Integrations**
2. Enter `owner` / `repo` / `branch` / `suites` path
3. Click **Install GitHub App** and approve access to the repository
4. Pull suites manually or rely on the `push` webhook

PAT remains supported as a fallback — saving a new PAT clears the App installation link.

## 4. Webhook security

When `GITHUB_WEBHOOK_SECRET` is set, ShipGauge verifies `X-Hub-Signature-256` on all GitHub webhooks.

`installation` `deleted` events clear `installation_id` from affected projects.

## 5. Local development

Use [smee.io](https://smee.io) or Stripe-style tunnel to forward webhooks to `localhost:3000/api/webhooks/github`.

For App install callback, set Setup URL to your tunnel URL + `/api/github/app/callback`.
