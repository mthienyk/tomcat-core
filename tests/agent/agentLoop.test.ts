import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../src/agent/agentLoop.js";
import { createMockProvider } from "../../src/llm/providers/mock.js";
import {
  AGENT_TOOL_NAMES,
  type AgentToolServices,
} from "../../src/agent/toolRegistry.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Auditor } from "../../src/audit/audit.js";
import type { LlmAgentStepResult } from "../../src/llm/types.js";

const human: Identity = {
  kind: "human",
  email: "test@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
};

const noopAuditor = (): Auditor =>
  ({
    record: vi.fn(),
  }) as unknown as Auditor;

const fakeServices = (): AgentToolServices =>
  ({
    startups: {
      findSimilar: vi.fn(),
      searchStartups: vi.fn().mockResolvedValue([]),
      listAccessibleNotes: vi.fn(),
      listAccessibleDeals: vi.fn(),
      listAccessibleMeetings: vi.fn(),
    },
    society: {
      getInvestorHome: vi.fn(),
      getPortfolioSignals: vi.fn().mockResolvedValue([
        {
          id: "sig_1",
          portfolioCompanyId: "portfolio_1",
          kind: "risk",
          summary: "Cash runway under 6 months.",
          detectedAt: "2026-05-01",
          sourceUrl: undefined,
          visibilityTier: "internal_only",
        },
      ]),
      ensurePortfolioCompanyInScope: vi.fn().mockResolvedValue(undefined),
    },
    companyContext: {
      resolveEntity: vi.fn(),
      listCompanyCrmActivity: vi.fn(),
      listCompanyDocuments: vi.fn(),
      readCompanyDocumentExcerpt: vi.fn(),
      listPortfolioContext: vi.fn(),
      buildCompany360Context: vi.fn(),
    },
    signalHub: {
      listWatched: vi.fn(),
      addWatched: vi.fn(),
      setPriority: vi.fn(),
      listEvents: vi.fn(),
      resolveEntity: vi.fn(),
      listUnipileAccounts: vi.fn(),
      requestRefresh: vi.fn(),
      freezeUnipileAccount: vi.fn(),
    },
    competitiveHistory: {
      findCompetitiveHistory: vi.fn(),
    },
    companyDriveFolder: {
      resolveCompanyDriveFolder: vi.fn(),
    },
    boardBrief: {
      prepareBoardBrief: vi.fn(),
      prepareLegacyBoardPrepContext: vi.fn(),
      legacyBoardPrepBody: vi.fn(),
    },
    portfolioSignalDigest: {
      generatePortfolioSignalDigest: vi.fn(),
    },
    companyActivitySummary: {
      summarizeCompanyActivity: vi.fn(),
    },
    findLatestDeck: {
      findLatestDeck: vi.fn(),
    },
    bpWorkflow: {
      assembleCompanyFinancePack: vi.fn(),
      draftBpTabDebt: vi.fn(),
    },
    portfolioCompanies: {
      listPortfolioCompanies: vi.fn(),
    },
  }) as unknown as AgentToolServices;

describe("runAgentLoop", () => {
  it("exposes the registry tools to the provider on every step", async () => {
    const seenToolNames: string[][] = [];
    const provider = createMockProvider({
      agent: (req): LlmAgentStepResult => {
        seenToolNames.push(req.tools.map((tool) => tool.name));
        return { text: "Nothing to do.", toolUses: [], stopReason: "end_turn" };
      },
    });

    await runAgentLoop({
      provider,
      services: fakeServices(),
      caller: human,
      auditor: noopAuditor(),
      text: "Tell me a story.",
    });

    expect(seenToolNames[0]).toEqual([...AGENT_TOOL_NAMES]);
  });

  it("executes a registered tool, feeds the result back and stops on end_turn", async () => {
    const provider = createMockProvider({
      agent: (_req, callIndex): LlmAgentStepResult => {
        if (callIndex === 0) {
          return {
            text: "",
            toolUses: [
              {
                id: "tool_1",
                name: "list_portfolio_signals",
                input: { portfolioCompanyId: "portfolio_1", sinceDays: 14 },
              },
            ],
            stopReason: "tool_use",
          };
        }
        return {
          text: "Found 1 risk signal for portfolio_1 in the last 14 days.",
          toolUses: [],
          stopReason: "end_turn",
        };
      },
    });

    const result = await runAgentLoop({
      provider,
      services: fakeServices(),
      caller: human,
      auditor: noopAuditor(),
      text: "Show recent risks for the active company.",
      context: { currentPortfolioCompanyId: "portfolio_1" },
    });

    expect(result.steps).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe("list_portfolio_signals");
    expect(result.toolResults).toHaveLength(1);
    expect(result.finalText).toContain("risk signal");
    expect(result.unknownToolsRequested).toEqual([]);
  });

  it("returns an unknown-tool error to the model when the model invents a tool", async () => {
    const errorContents: string[] = [];
    const provider = createMockProvider({
      agent: (req, callIndex): LlmAgentStepResult => {
        if (callIndex === 0) {
          return {
            text: "",
            toolUses: [
              {
                id: "tool_x",
                name: "delete_everything",
                input: {},
              },
            ],
            stopReason: "tool_use",
          };
        }
        const lastMessage = req.messages[req.messages.length - 1];
        if (lastMessage?.role === "tool") {
          for (const item of lastMessage.results) {
            if (item.isError) errorContents.push(item.content);
          }
        }
        return {
          text: "I cannot perform that action.",
          toolUses: [],
          stopReason: "end_turn",
        };
      },
    });

    const result = await runAgentLoop({
      provider,
      services: fakeServices(),
      caller: human,
      auditor: noopAuditor(),
      text: "Delete everything.",
    });

    expect(result.unknownToolsRequested).toEqual(["delete_everything"]);
    expect(result.toolCalls).toHaveLength(0);
    expect(errorContents.join("\n")).toContain("Unknown tool");
    expect(result.finalText).toBe("I cannot perform that action.");
  });

  it("returns the model's text without tool calls when context is missing", async () => {
    const provider = createMockProvider({
      agent: (req): LlmAgentStepResult => {
        const userPrompt = req.messages[0];
        if (userPrompt?.role === "user") {
          expect(userPrompt.content).toContain(
            "No conversation context provided.",
          );
        }
        return {
          text: "Quel est le nom de la startup concernée ?",
          toolUses: [],
          stopReason: "end_turn",
        };
      },
    });

    const result = await runAgentLoop({
      provider,
      services: fakeServices(),
      caller: human,
      auditor: noopAuditor(),
      text: "Prépare-moi un brief pour cette startup.",
    });

    expect(result.toolCalls).toHaveLength(0);
    expect(result.finalText).toMatch(/startup/i);
    expect(result.steps).toBe(1);
  });
});

describe("registry tool definitions", () => {
  it("converts every registered tool into a JSON schema with object root", async () => {
    const { buildLlmToolDefinitions } = await import(
      "../../src/agent/toolRegistry.js"
    );
    const tools = buildLlmToolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual([...AGENT_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
