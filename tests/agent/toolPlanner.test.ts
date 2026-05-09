import { describe, expect, it } from "vitest";
import { planToolCalls } from "../../src/agent/toolPlanner.js";
import { createMockProvider } from "../../src/llm/providers/mock.js";
import { CoreError } from "../../src/errors/index.js";

describe("planToolCalls", () => {
  it("accepts a valid tool plan from the LLM", async () => {
    const provider = createMockProvider(() =>
      JSON.stringify({
        reasoning: "The user asks for portfolio signals, so one signal tool is enough.",
        toolCalls: [
          {
            toolName: "list_portfolio_signals",
            arguments: { portfolioCompanyId: "portfolio_1", sinceDays: 7 },
          },
        ],
      }),
    );

    const plan = await planToolCalls(provider, "Show recent portfolio signals.");

    expect(plan.toolCalls).toEqual([
      {
        toolName: "list_portfolio_signals",
        arguments: { portfolioCompanyId: "portfolio_1", sinceDays: 7 },
      },
    ]);
  });

  it("rejects unknown tools", async () => {
    const provider = createMockProvider(() =>
      JSON.stringify({
        reasoning: "Invalid plan.",
        toolCalls: [{ toolName: "read_everything", arguments: {} }],
      }),
    );

    await expect(planToolCalls(provider, "Read everything")).rejects.toBeInstanceOf(
      CoreError,
    );
  });
});
