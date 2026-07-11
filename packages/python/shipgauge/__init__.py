"""ShipGauge Python SDK — record LLM usage and optional OpenAI wrapper."""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

PRICING: dict[str, dict[str, float | str]] = {
    "gpt-4o": {"input": 2.5, "output": 10.0, "provider": "openai"},
    "gpt-4o-mini": {"input": 0.15, "output": 0.6, "provider": "openai"},
    "gpt-4.1": {"input": 2.0, "output": 8.0, "provider": "openai"},
    "gpt-4.1-mini": {"input": 0.4, "output": 1.6, "provider": "openai"},
}


def calculate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = PRICING.get(model)
    if not pricing:
        return 0.0
    cost = (
        (input_tokens / 1_000_000) * float(pricing["input"])
        + (output_tokens / 1_000_000) * float(pricing["output"])
    )
    return round(cost, 6)


def configure_pricing(
    overrides: dict[str, dict[str, float | str]],
) -> None:
    for model, pricing in overrides.items():
        PRICING[model] = {
            "input": float(pricing["input"]),
            "output": float(pricing["output"]),
            "provider": str(pricing.get("provider", "custom")),
        }


class BudgetBlockError(RuntimeError):
    def __init__(
        self,
        *,
        feature: str,
        limit_usd: float,
        spent_usd: float,
        resets_at: str,
    ) -> None:
        super().__init__(f"budget exceeded for {feature}")
        self.feature = feature
        self.limit_usd = limit_usd
        self.spent_usd = spent_usd
        self.resets_at = resets_at


_budget_throw_on_block = True
_budget_on_block: Any | None = None


def configure_budget(
    *,
    throw_on_block: bool = True,
    on_block: Any | None = None,
) -> None:
    global _budget_throw_on_block, _budget_on_block
    _budget_throw_on_block = throw_on_block
    _budget_on_block = on_block


def reset_budget() -> None:
    configure_budget(throw_on_block=True, on_block=None)


def _handle_http_error(exc: urllib.error.HTTPError) -> bool:
    if exc.code != 429:
        return False
    body = exc.read().decode("utf-8")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False
    if payload.get("error") != "budget_exceeded":
        return False
    block = BudgetBlockError(
        feature=str(payload.get("feature", "")),
        limit_usd=float(payload.get("limit_usd", 0)),
        spent_usd=float(payload.get("spent_usd", 0)),
        resets_at=str(payload.get("resets_at", "")),
    )
    if _budget_on_block:
        _budget_on_block(block)
    if not _budget_throw_on_block:
        return True
    raise block


@dataclass
class ShipGauge:
    api_key: str
    project_id: str
    environment: str = "production"
    base_url: str = "http://localhost:3000"

    def record(
        self,
        *,
        feature_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        provider: str | None = None,
        latency_ms: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._post_events([self._build_event(
            feature_id=feature_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider=provider,
            latency_ms=latency_ms,
            metadata=metadata,
        )])

    async def record_async(
        self,
        *,
        feature_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        provider: str | None = None,
        latency_ms: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.record,
            feature_id=feature_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider=provider,
            latency_ms=latency_ms,
            metadata=metadata,
        )

    def _build_event(
        self,
        *,
        feature_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        provider: str | None = None,
        latency_ms: int | None = None,
        metadata: dict[str, Any] | None = None,
        environment: str | None = None,
    ) -> dict[str, Any]:
        pricing = PRICING.get(model, {})
        resolved_provider = provider or str(pricing.get("provider", "openai"))
        return {
            "feature_id": feature_id,
            "model": model,
            "provider": resolved_provider,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": latency_ms,
            "environment": environment or self.environment,
            "metadata": metadata or {},
        }

    def _post_events(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        payload = json.dumps({"events": events}).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/v1/events",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if _handle_http_error(exc):
                return {"blocked": True, "cost_usd": 0.0}
            body = exc.read().decode("utf-8")
            raise RuntimeError(f"ShipGauge ingest failed ({exc.code}): {body}") from exc

    def _get_json(self, path: str) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            headers={"Authorization": f"Bearer {self.api_key}"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            raise RuntimeError(f"ShipGauge request failed ({exc.code}): {body}") from exc

    def record_batch(
        self,
        events: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not events:
            return {"accepted": 0, "cost_usd": 0.0}

        normalized = [
            {**event, "environment": event.get("environment", self.environment)}
            for event in events
        ]
        return self._post_events(normalized)

    async def record_batch_async(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        return await asyncio.to_thread(self.record_batch, events)

    def get_budget_status(self) -> dict[str, Any]:
        return self._get_json("/api/v1/budget-status")

    async def get_budget_status_async(self) -> dict[str, Any]:
        return await asyncio.to_thread(self.get_budget_status)

    def wrap_openai(self, client: Any, *, default_feature_id: str = "default") -> Any:
        """Wrap OpenAI client chat.completions.create to auto-record usage."""

        original_create = client.chat.completions.create

        def create_wrapper(*args: Any, **kwargs: Any) -> Any:
            started = time.time()
            result = original_create(*args, **kwargs)
            latency_ms = int((time.time() - started) * 1000)

            usage = getattr(result, "usage", None)
            model = getattr(result, "model", None) or kwargs.get("model", "gpt-4o-mini")
            input_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
            output_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
            metadata = _extract_openai_output_sample(result)

            self.record(
                feature_id=default_feature_id,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                metadata=metadata,
            )
            return result

        client.chat.completions.create = create_wrapper  # type: ignore[method-assign]
        return client

    def wrap_anthropic(self, client: Any, *, default_feature_id: str = "default") -> Any:
        """Wrap Anthropic client messages.create to auto-record usage."""

        original_create = client.messages.create

        def create_wrapper(*args: Any, **kwargs: Any) -> Any:
            started = time.time()
            result = original_create(*args, **kwargs)
            latency_ms = int((time.time() - started) * 1000)

            usage = getattr(result, "usage", None)
            model = getattr(result, "model", None) or kwargs.get("model", "claude-3-5-haiku-20241022")
            input_tokens = getattr(usage, "input_tokens", 0) if usage else 0
            output_tokens = getattr(usage, "output_tokens", 0) if usage else 0
            metadata = _extract_anthropic_output_sample(result)

            self.record(
                feature_id=default_feature_id,
                model=model,
                provider="anthropic",
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                metadata=metadata,
            )
            return result

        client.messages.create = create_wrapper  # type: ignore[method-assign]
        return client

    def track(
        self,
        *,
        feature_id: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        latency_ms: int | None = None,
    ) -> "_TrackContext":
        return _TrackContext(self, feature_id, model, input_tokens, output_tokens, latency_ms)


@dataclass
class _TrackContext:
    sg: ShipGauge
    feature_id: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int | None
    _started: float = field(default_factory=time.time)

    def __enter__(self) -> "_TrackContext":
        return self

    def __exit__(self, *_: Any) -> None:
        latency = self.latency_ms
        if latency is None:
            latency = int((time.time() - self._started) * 1000)
        self.sg.record(
            feature_id=self.feature_id,
            model=self.model,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            latency_ms=latency,
        )


__all__ = [
    "ShipGauge",
    "BudgetBlockError",
    "calculate_cost_usd",
    "configure_pricing",
    "configure_budget",
    "reset_budget",
]


def _extract_openai_output_sample(result: Any) -> dict[str, Any] | None:
    choices = getattr(result, "choices", None)
    if not choices:
        return None
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", None) if message else None
    if isinstance(content, str) and content.strip():
        cleaned = " ".join(content.split())[:280]
        return {"output_sample": cleaned}
    return None


def _extract_anthropic_output_sample(result: Any) -> dict[str, Any] | None:
    content = getattr(result, "content", None)
    if not content:
        return None
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text.strip():
            cleaned = " ".join(text.split())[:280]
            return {"output_sample": cleaned}
    return None
