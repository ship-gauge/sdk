"""FastAPI + OpenAI example with ShipGauge cost tracking."""

import os

from fastapi import FastAPI
from openai import OpenAI
from pydantic import BaseModel
from shipgauge import ShipGauge

app = FastAPI(title="ShipGauge Python FastAPI Example")

sg = ShipGauge(
    api_key=os.environ["SHIPGAUGE_API_KEY"],
    project_id=os.environ["SHIPGAUGE_PROJECT_ID"],
    base_url=os.environ.get("SHIPGAUGE_BASE_URL", "http://localhost:3000"),
    environment=os.environ.get("VERCEL_ENV", "development"),
)

client = sg.wrap_openai(
    OpenAI(api_key=os.environ["OPENAI_API_KEY"]),
    default_feature_id="chat",
)


class ChatRequest(BaseModel):
    message: str = "Say hello in one word"


@app.post("/chat")
def chat(body: ChatRequest) -> dict:
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": body.message}],
    )
    return {
        "reply": completion.choices[0].message.content or "",
        "model": completion.model,
        "feature_id": "chat",
    }
