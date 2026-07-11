# Python FastAPI + OpenAI + ShipGauge

Minimal FastAPI app that wraps OpenAI with ShipGauge for per-feature cost tracking.

## Setup

```bash
cd examples/python-fastapi
cp .env.example .env
# Edit .env with your keys

# From monorepo root:
pip install -e ../../packages/python
pip install -r requirements.txt
```

## Run

```bash
export $(grep -v '^#' .env | xargs)
uvicorn main:app --reload --port 3002
```

## Test

```bash
curl -X POST http://localhost:3002/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in one word"}'
```

Open your ShipGauge project **Overview** — spend should appear under feature `chat`.

## CI gate

Use the same `examples/suites/smoke.yaml` and GitHub Action as the Next.js example.
