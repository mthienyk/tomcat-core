import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "../../src/llm/providers/openai.js";

const mockResponsesCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      responses = { create: mockResponsesCreate };
      chat = { completions: { create: vi.fn() } };
    },
  };
});

afterEach(() => {
  mockResponsesCreate.mockReset();
});

describe("OpenAI provider runAgentStep", () => {
  it("converts assistant tool uses + tool results into Responses input items", async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      ],
      status: "completed",
    });

    const provider = createOpenAIProvider("sk-test");
    const result = await provider.runAgentStep({
      model: "gpt-5.5",
      system: "You are Tomcat Core.",
      messages: [
        { role: "user", content: "Recap risks for portfolio_1" },
        {
          role: "assistant",
          content: "",
          toolUses: [
            {
              id: "call_abc",
              name: "list_portfolio_signals",
              input: { portfolioCompanyId: "portfolio_1" },
            },
          ],
        },
        {
          role: "tool",
          results: [
            {
              toolUseId: "call_abc",
              content: '{"signals":[]}',
              isError: false,
            },
          ],
        },
      ],
      tools: [
        {
          name: "list_portfolio_signals",
          description: "List signals",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const sentInput = mockResponsesCreate.mock.calls[0]?.[0]?.input as Array<
      Record<string, unknown>
    >;
    expect(sentInput).toEqual([
      { role: "user", content: "Recap risks for portfolio_1" },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "list_portfolio_signals",
        arguments: JSON.stringify({ portfolioCompanyId: "portfolio_1" }),
      },
      {
        type: "function_call_output",
        call_id: "call_abc",
        output: '{"signals":[]}',
      },
    ]);

    expect(result.text).toBe("Done.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolUses).toEqual([]);
  });

  it("parses function_call output items into structured tool uses", async () => {
    mockResponsesCreate.mockResolvedValueOnce({
      output: [
        {
          type: "function_call",
          call_id: "call_xyz",
          name: "search_startups",
          arguments: JSON.stringify({ sector: "fintech" }),
        },
      ],
      status: "completed",
    });

    const provider = createOpenAIProvider("sk-test");
    const result = await provider.runAgentStep({
      model: undefined,
      system: "system",
      messages: [{ role: "user", content: "Find fintech startups" }],
      tools: [
        {
          name: "search_startups",
          description: "Search startups",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    expect(result.toolUses).toEqual([
      { id: "call_xyz", name: "search_startups", input: { sector: "fintech" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
  });
});
