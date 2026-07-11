import { afterEach, describe, expect, it, vi } from "vitest";

import { exportLlmSpan } from "./otel.js";

describe("exportLlmSpan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs OTLP JSON to configured endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await exportLlmSpan(
      { endpoint: "https://otel.example/v1/traces", serviceName: "test-svc" },
      {
        featureId: "chat",
        model: "gpt-4o-mini",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.001,
        projectId: "proj-1",
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://otel.example/v1/traces");
    const body = JSON.parse(String(init.body));
    expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("llm.chat");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("swallows network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      exportLlmSpan(
        { endpoint: "https://otel.example/v1/traces" },
        {
          featureId: "x",
          model: "m",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
