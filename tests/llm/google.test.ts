import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "../../src/llm/providers/google.js";

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
});

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("Gemini provider runAgentStep", () => {
  it("sends sanitized function declarations and parses functionCall parts", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    id: "fc_1",
                    name: "search_startups",
                    args: { sector: "climate" },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );

    const provider = createGoogleProvider("AIza-test");
    const result = await provider.runAgentStep({
      model: "gemini-3.1-pro-preview",
      system: "You are Tomcat Core.",
      messages: [{ role: "user", content: "Show climate startups" }],
      tools: [
        {
          name: "search_startups",
          description: "Search startups",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: { sector: { type: "string" } },
            additionalProperties: false,
          },
        },
      ],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    const tools = body["tools"] as Array<{
      functionDeclarations: Array<{ parameters: Record<string, unknown> }>;
    }>;
    const params = tools[0]!.functionDeclarations[0]!.parameters;
    expect(params).not.toHaveProperty("$schema");
    expect(params).not.toHaveProperty("additionalProperties");
    expect(params).toMatchObject({ type: "object" });

    expect(result.toolUses).toEqual([
      { id: "fc_1", name: "search_startups", input: { sector: "climate" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
  });

  it("converts assistant tool uses + tool results into model + functionResponse parts", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "All good." }] },
            finishReason: "STOP",
          },
        ],
      }),
    );

    const provider = createGoogleProvider("AIza-test");
    await provider.runAgentStep({
      model: undefined,
      system: "sys",
      messages: [
        { role: "user", content: "List signals" },
        {
          role: "assistant",
          content: "",
          toolUses: [
            {
              id: "fc_xx",
              name: "list_portfolio_signals",
              input: { portfolioCompanyId: "portfolio_1" },
            },
          ],
        },
        {
          role: "tool",
          results: [
            {
              toolUseId: "fc_xx",
              content: '{"signals":[]}',
              isError: false,
            },
          ],
        },
      ],
      tools: [
        {
          name: "list_portfolio_signals",
          description: "x",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as { contents: Array<{ role: string; parts: unknown[] }> };

    expect(body.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "List signals" }],
    });
    expect(body.contents[1]).toMatchObject({
      role: "model",
      parts: [
        {
          functionCall: {
            id: "fc_xx",
            name: "list_portfolio_signals",
            args: { portfolioCompanyId: "portfolio_1" },
          },
        },
      ],
    });
    expect(body.contents[2]).toMatchObject({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "fc_xx",
            name: "list_portfolio_signals",
            response: { signals: [] },
          },
        },
      ],
    });
  });
});
