import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSerperConnector, createUnconfiguredSerperConnector } from "../../src/connectors/serper.js";
import { CoreError } from "../../src/errors/index.js";

const makeFetch = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response);

const SERPER_RESPONSE = {
  organic: [
    {
      title: "John Doe: We raised our Series A",
      link: "https://linkedin.com/posts/johndoe-activity-111",
      snippet: "Proud to announce our Series A funding round",
      date: "2026-05-15",
    },
    {
      title: "John Doe: Hiring",
      link: "https://linkedin.com/posts/johndoe-activity-222",
      snippet: "We are looking for engineers",
      date: "2026-05-10",
    },
  ],
};

describe("createSerperConnector", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("returns mapped results from searchLinkedinPosts", async () => {
    vi.stubGlobal("fetch", makeFetch(SERPER_RESPONSE));
    const connector = createSerperConnector("test-key");
    const results = await connector.searchLinkedinPosts("John Doe", { limit: 10 });
    expect(results).toHaveLength(2);
    expect(results[0].link).toBe("https://linkedin.com/posts/johndoe-activity-111");
    expect(results[0].title).toBe("John Doe: We raised our Series A");
    expect(results[0].date).toBe("2026-05-15");
  });

  it("sends X-API-KEY header", async () => {
    const fetch = makeFetch(SERPER_RESPONSE);
    vi.stubGlobal("fetch", fetch);
    const connector = createSerperConnector("my-serper-key");
    await connector.searchLinkedinPosts("test");
    const headers = (fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("my-serper-key");
  });

  it("returns empty array when organic is absent", async () => {
    vi.stubGlobal("fetch", makeFetch({}));
    const connector = createSerperConnector("key");
    const results = await connector.searchLinkedinPosts("nobody");
    expect(results).toEqual([]);
  });

  it("throws ConnectorFailed on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch({ error: "unauthorized" }, 401));
    const connector = createSerperConnector("bad-key");
    await expect(connector.searchLinkedinPosts("test")).rejects.toBeInstanceOf(CoreError);
  });
});

describe("createUnconfiguredSerperConnector", () => {
  it("throws CONNECTOR_NOT_CONFIGURED", async () => {
    const connector = createUnconfiguredSerperConnector();
    await expect(connector.searchLinkedinPosts("test")).rejects.toMatchObject({
      code: "CONNECTOR_NOT_CONFIGURED",
    });
  });
});
