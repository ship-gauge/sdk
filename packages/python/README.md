# shipgauge

Python SDK for ShipGauge cost tracking.

```python
from shipgauge import ShipGauge
from openai import OpenAI

sg = ShipGauge(api_key="sg_ingest_...", project_id="proj_...")
client = sg.wrap_openai(OpenAI(), default_feature_id="chat")

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

Or manual recording:

```python
with sg.track(feature_id="summarize", model="gpt-4o-mini", input_tokens=500, output_tokens=120):
    # your LLM call
    ...
```
