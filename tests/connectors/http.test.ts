import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../../src/connectors/http.js";

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (status: number, body = ""): Response =>
  new Response(body, { status });

describe("createHttpClient", () => {
  it("returns parsed JSON on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ hello: "world" }));
    const client = createHttpClient({
      connector: "test",
      baseUrl: "https://api.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.json<{ hello: string }>("/ping");
    expect(data).toEqual({ hello: "world" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.com/ping");
  });

  it("retries on 503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "boom"))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    const client = createHttpClient({
      connector: "test",
      baseUrl: "https://api.example.com",
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.json<{ ok: boolean }>("/x");
    expect(data.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400 and throws ConnectorFailed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errorResponse(400, "bad"));
    const client = createHttpClient({
      connector: "test",
      baseUrl: "https://api.example.com",
      maxAttempts: 3,
      baseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.json("/x")).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("respects retry-after header", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate-limited", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(okResponse({ ok: 1 }));
    const client = createHttpClient({
      connector: "test",
      maxAttempts: 2,
      baseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const data = await client.json<{ ok: number }>("https://x.test/y");
    expect(data.ok).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts after timeout and throws ConnectorFailed", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const client = createHttpClient({
      connector: "test",
      timeoutMs: 5,
      maxAttempts: 1,
      baseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.json("https://slow.test/y")).rejects.toThrow(/failed/);
  });
});
