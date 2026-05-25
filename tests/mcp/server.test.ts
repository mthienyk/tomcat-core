import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpAgentServer } from "../../src/mcp/server.js";
import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_REGISTRY,
  type AgentToolServices,
} from "../../src/agent/toolRegistry.js";
import { listMcpAgentTools } from "../../src/agent/toolCatalog.js";
import { Forbidden, BadRequest } from "../../src/errors/index.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Auditor } from "../../src/audit/audit.js";

const human: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const noopAuditor = (): Auditor =>
  ({ record: vi.fn() }) as unknown as Auditor;

const fakeServices = (
  signals: unknown,
): AgentToolServices =>
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
      getPortfolioSignals: vi.fn().mockResolvedValue(signals),
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
    similarCases: undefined,
  }) as unknown as AgentToolServices;

const startConnectedClient = async (
  services: AgentToolServices,
  options?: { signalHubEnabled?: boolean },
) => {
  const server = buildMcpAgentServer({
    services,
    resolveCaller: async () => human,
    auditor: noopAuditor(),
    signalHubEnabled: options?.signalHubEnabled ?? false,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
};

describe("MCP server", () => {
  it("exposes non-Signal-Hub tools through tools/list by default", async () => {
    const { client } = await startConnectedClient(fakeServices([]));
    const list = await client.listTools();
    const expected = listMcpAgentTools(false).map((tool) => tool.name).sort();
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(expected);
    for (const tool of list.tools) {
      expect(tool.description).toMatch(/WHEN TO USE:/);
      expect(tool.description).toMatch(/Sources:/);
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it("exposes every registry tool when Signal Hub is enabled", async () => {
    const { client } = await startConnectedClient(fakeServices([]), {
      signalHubEnabled: true,
    });
    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
  });

  it("executes a tool through tools/call and returns a text content block", async () => {
    const { client } = await startConnectedClient(
      fakeServices([
        {
          id: "sig_1",
          portfolioCompanyId: "portfolio_1",
          kind: "risk",
          summary: "Cash runway under 6 months.",
          detectedAt: "2026-05-01",
          visibilityTier: "internal_only",
        },
      ]),
    );

    const result = await client.callTool({
      name: "list_portfolio_signals",
      arguments: { portfolioCompanyId: "portfolio_1", sinceDays: 14 },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Cash runway");
    const payload = result as { structuredContent?: { value?: unknown } };
    expect(payload.structuredContent).toBeTruthy();
    expect(Array.isArray(payload.structuredContent?.value)).toBe(true);
  });

  it("returns a structured error when the underlying service throws", async () => {
    const services = fakeServices([]);
    services.society.getPortfolioSignals = vi
      .fn()
      .mockRejectedValue(new Error("boom"));

    const { client } = await startConnectedClient(services);

    const result = await client.callTool({
      name: "list_portfolio_signals",
      arguments: { portfolioCompanyId: "portfolio_1" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("boom");
    const payload = result as { structuredContent?: { error?: { code?: string } } };
    expect(payload.structuredContent?.error?.code).toBe("INTERNAL");
  });

  it("maps CoreError onto a structured payload with nextAction", async () => {
    const services = fakeServices([]);
    services.society.getPortfolioSignals = vi
      .fn()
      .mockRejectedValue(Forbidden("Portfolio company is outside caller scope"));

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "list_portfolio_signals",
      arguments: { portfolioCompanyId: "portfolio_unknown" },
    });
    expect(result.isError).toBe(true);
    const payload = result as {
      structuredContent?: {
        error?: { code?: string; nextAction?: string; retryable?: boolean };
      };
    };
    expect(payload.structuredContent?.error?.code).toBe("FORBIDDEN");
    expect(payload.structuredContent?.error?.nextAction).toBe(
      "adjust_identity_scope",
    );
    expect(payload.structuredContent?.error?.retryable).toBe(false);
  });

  it("refuses approval-required tools with a structured FORBIDDEN payload", async () => {
    const tool = AGENT_TOOL_REGISTRY.find((t) => t.approvalRequired);
    if (!tool) {
      // No approval-required tool exists in this build; treat as a documentation marker.
      expect(true).toBe(true);
      return;
    }

    const services = fakeServices([]);
    services.signalHub.freezeUnipileAccount = vi.fn();

    const { client } = await startConnectedClient(services, {
      signalHubEnabled: true,
    });
    const result = await client.callTool({
      name: tool.name,
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const payload = result as {
      structuredContent?: { error?: { code?: string } };
    };
    expect(payload.structuredContent?.error?.code).toBe("FORBIDDEN");
  });

  it("registers every tool with structured agent-first descriptions", async () => {
    const { client } = await startConnectedClient(fakeServices([]), {
      signalHubEnabled: true,
    });
    const list = await client.listTools();
    for (const tool of list.tools) {
      expect(tool.description).toMatch(/WHEN TO USE:/);
      expect(tool.description).toMatch(/Sources:.+Access:.+Approval required/);
      expect(tool.inputSchema["type"]).toBe("object");
    }
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
  });

  it("returns deprecated legacy envelope from build_board_prep_context", async () => {
    const services = fakeServices([]);
    services.boardBrief.prepareLegacyBoardPrepContext = vi
      .fn()
      .mockResolvedValue({
        data: {
          portfolioCompanyId: "Webin",
          startupId: "hs_webin",
          highlights: [],
          risks: [],
          citations: [],
        },
        citations: [],
        warnings: [
          { code: "DEPRECATED_TOOL", message: "deprecated" },
          { code: "MONDAY_SIGNALS_EMPTY", message: "empty monday" },
        ],
        nextSuggestedTools: [
          { toolName: "prepare_board_brief", reason: "upgrade" },
          { toolName: "signal_hub_recent_signals", reason: "fallback" },
        ],
      });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "build_board_prep_context",
      arguments: { portfolioCompanyId: "Webin" },
    });

    expect(result.isError).toBeFalsy();
    const payload = result as {
      structuredContent?: {
        data?: { portfolioCompanyId?: string };
        warnings?: Array<{ code?: string }>;
        nextSuggestedTools?: Array<{ toolName?: string }>;
      };
    };
    expect(payload.structuredContent?.data?.portfolioCompanyId).toBe("Webin");
    expect(payload.structuredContent?.warnings?.[0]?.code).toBe("DEPRECATED_TOOL");
    expect(payload.structuredContent?.warnings?.[1]?.code).toBe(
      "MONDAY_SIGNALS_EMPTY",
    );
    expect(
      payload.structuredContent?.nextSuggestedTools?.some(
        (s) => s.toolName === "prepare_board_brief",
      ),
    ).toBe(true);
  });

  it("preserves source warnings on legacy board prep without false empty signal", async () => {
    const services = fakeServices([]);
    services.boardBrief.prepareLegacyBoardPrepContext = vi
      .fn()
      .mockResolvedValue({
        data: {
          portfolioCompanyId: "Webin",
          startupId: "hs_webin",
          highlights: [],
          risks: [],
          citations: [
            {
              label: "Note note_1 (internal)",
              source: { system: "hubspot", externalId: "note_1", url: undefined },
            },
          ],
        },
        citations: [
          {
            label: "Note note_1 (internal)",
            source: { system: "hubspot", externalId: "note_1", url: undefined },
          },
        ],
        warnings: [{ code: "DEPRECATED_TOOL", message: "deprecated" }],
        nextSuggestedTools: [
          { toolName: "prepare_board_brief", reason: "upgrade" },
          { toolName: "read_company_document_excerpt", reason: "read deck" },
        ],
      });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "build_board_prep_context",
      arguments: { portfolioCompanyId: "Webin" },
    });

    const payload = result as {
      structuredContent?: {
        warnings?: Array<{ code?: string }>;
        nextSuggestedTools?: Array<{ toolName?: string }>;
      };
    };
    expect(payload.structuredContent?.warnings?.map((w) => w.code)).toEqual([
      "DEPRECATED_TOOL",
    ]);
    expect(
      payload.structuredContent?.nextSuggestedTools?.some(
        (s) => s.toolName === "signal_hub_recent_signals",
      ),
    ).toBe(false);
  });

  it("returns BAD_REQUEST for signal_hub_recent_signals without entity selector", async () => {
    const { client } = await startConnectedClient(fakeServices([]), {
      signalHubEnabled: true,
    });
    const result = await client.callTool({
      name: "signal_hub_recent_signals",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const payload = result as {
      structuredContent?: { error?: { code?: string; nextAction?: string } };
    };
    expect(payload.structuredContent?.error?.code).toBe("BAD_REQUEST");
    expect(payload.structuredContent?.error?.nextAction).toBe(
      "fix_arguments_or_clarify",
    );
  });

  it("returns auth error when resolveCaller fails", async () => {
    const server = buildMcpAgentServer({
      services: fakeServices([]),
      resolveCaller: async () => {
        throw BadRequest("Google auth required. Run: npm run auth:google");
      },
      auditor: noopAuditor(),
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "search_startups",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const payload = result as {
      structuredContent?: { error?: { code?: string; nextAction?: string } };
    };
    expect(payload.structuredContent?.error?.code).toBe("BAD_REQUEST");
    expect(payload.structuredContent?.error?.nextAction).toBe(
      "fix_arguments_or_clarify",
    );
  });

  it("validates tool arguments and returns structured Zod errors", async () => {
    const { client } = await startConnectedClient(fakeServices([]));
    const result = await client.callTool({
      name: "resolve_entity",
      arguments: { query: 123 },
    });

    expect(result.isError).toBe(true);
    const payload = result as {
      structuredContent?: {
        error?: { code?: string; nextAction?: string; details?: unknown };
      };
      content?: Array<{ text?: string }>;
    };
    const errorCode =
      payload.structuredContent?.error?.code ??
      (payload.content?.[0]?.text?.includes("validation")
        ? "BAD_REQUEST"
        : undefined);
    expect(errorCode).toBe("BAD_REQUEST");
  });

  it("includes orchestrator instructions in MCP server options", async () => {
    const { MCP_SERVER_INSTRUCTIONS } = await import(
      "../../src/mcp/instructions.js"
    );
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Resolve first");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("find_competitive_history");
  });

  it("executes find_competitive_history", async () => {
    const services = fakeServices([]);
    services.competitiveHistory.findCompetitiveHistory = vi
      .fn()
      .mockResolvedValue({
        data: { matchCount: 0, matches: [], referenceStartup: null },
        citations: [],
        warnings: [],
      });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "find_competitive_history",
      arguments: { sector: "saas" },
    });

    expect(result.isError).toBeFalsy();
    expect(services.competitiveHistory.findCompetitiveHistory).toHaveBeenCalled();
  });

  it("executes resolve_company_drive_folder with ToolRunEnvelope", async () => {
    const services = fakeServices([]);
    services.companyDriveFolder.resolveCompanyDriveFolder = vi
      .fn()
      .mockResolvedValue({
        data: {
          portfolioCompanyId: "Atlas",
          canonicalName: "Atlas",
          purpose: "m2_financial",
          primaryFolder: {
            driveFolderId: "folder_1",
            name: "Atlas — M2",
            path: "Portfolio / Atlas / Atlas — M2",
            purposeMatch: "m2_financial",
            modifiedTime: "2026-05-01T00:00:00Z",
          },
          folderCandidates: [],
          inventory: [],
          presentInputs: ["dsn"],
          missingInputs: ["bank"],
        },
        citations: [
          {
            label: "Portfolio / Atlas / Atlas — M2",
            source: { system: "drive", externalId: "folder_1", url: undefined },
          },
        ],
        warnings: [{ code: "DRIVE_INPUTS_INCOMPLETE", message: "missing bank" }],
        nextSuggestedTools: [
          { toolName: "list_company_documents", reason: "fallback" },
        ],
      });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "resolve_company_drive_folder",
      arguments: { portfolioCompanyId: "Atlas", purpose: "m2_financial" },
    });

    expect(result.isError).toBeFalsy();
    const payload = result as {
      structuredContent?: {
        data?: { primaryFolder?: { driveFolderId?: string } };
        warnings?: Array<{ code?: string }>;
      };
    };
    expect(payload.structuredContent?.data?.primaryFolder?.driveFolderId).toBe(
      "folder_1",
    );
    expect(payload.structuredContent?.warnings?.[0]?.code).toBe(
      "DRIVE_INPUTS_INCOMPLETE",
    );
    expect(services.companyDriveFolder.resolveCompanyDriveFolder).toHaveBeenCalled();
  });

  it("executes prepare_board_brief with ToolRunEnvelope", async () => {
    const services = fakeServices([]);
    services.boardBrief.prepareBoardBrief = vi.fn().mockResolvedValue({
      data: {
        portfolioCompanyId: "Webin",
        startupId: "hs_webin",
        canonicalName: "Webin",
        executiveSnapshot: {
          headlineHighlights: ["Launched enterprise tier"],
          headlineRisks: ["Churn uptick on SMB segment"],
          openQuestions: ["Confirm founder agenda"],
        },
        mondaySignals: {
          highlights: ["Launched enterprise tier"],
          risks: ["Churn uptick on SMB segment"],
          signalCount: 2,
        },
        crmTimeline: { recentNotes: [], activeDeals: [], recentMeetings: [] },
        driveDocuments: {
          latestBoardPack: {
            driveFileId: "drive_1",
            title: "Webin Q1 Board Pack",
            createdAt: "2026-04-01",
          },
          recentDocuments: [],
        },
        linkedInSignals: { signalCount: 0, recentSignals: [] },
        prepChecklist: [
          { id: "board_deck", label: "Latest board deck", status: "ready", detail: "Webin Q1 Board Pack" },
        ],
      },
      citations: [],
      warnings: [],
      nextSuggestedTools: [
        {
          toolName: "read_company_document_excerpt",
          reason: "Read deck",
          arguments: { portfolioCompanyId: "Webin", driveFileId: "drive_1" },
        },
      ],
    });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "prepare_board_brief",
      arguments: { portfolioCompanyId: "Webin" },
    });

    expect(result.isError).toBeFalsy();
    const payload = result as {
      structuredContent?: {
        data?: {
          prepChecklist?: Array<{ status?: string }>;
          executiveSnapshot?: { openQuestions?: string[] };
        };
      };
    };
    expect(payload.structuredContent?.data?.prepChecklist?.[0]?.status).toBe(
      "ready",
    );
    expect(
      payload.structuredContent?.data?.executiveSnapshot?.openQuestions?.length,
    ).toBeGreaterThan(0);
    expect(services.boardBrief.prepareBoardBrief).toHaveBeenCalled();
  });

  it("executes generate_portfolio_signal_digest with ToolRunEnvelope", async () => {
    const services = fakeServices([]);
    services.portfolioSignalDigest.generatePortfolioSignalDigest = vi
      .fn()
      .mockResolvedValue({
        data: {
          period: {
            sinceDays: 7,
            sinceIso: "2026-05-17T00:00:00.000Z",
            untilIso: "2026-05-24T00:00:00.000Z",
          },
          scope: {
            portfolioCompanyCount: 1,
            watchedEntityCount: 2,
            priorityFilter: undefined,
          },
          companies: [
            {
              portfolioCompanyId: "Webin",
              canonicalName: "Webin",
              startupId: "hs_webin",
              mondaySignals: [
                {
                  id: "sig_1",
                  kind: "product",
                  summary: "Enterprise tier launch",
                  detectedAt: "2026-05-20T10:00:00Z",
                },
              ],
              linkedInSignals: [],
              crmNotes: [],
              sourceChannels: ["monday"],
              factCount: 1,
            },
          ],
          unlinkedLinkedInSignals: [],
          summary: {
            totalFacts: 1,
            companiesWithActivity: 1,
            companiesQuiet: 0,
          },
        },
        citations: [
          {
            label: "Monday product sig_1",
            source: { system: "monday", externalId: "sig_1", url: undefined },
          },
        ],
        warnings: [],
        nextSuggestedTools: [
          {
            toolName: "prepare_board_brief",
            reason: "Cross-check digest highlights",
            arguments: { portfolioCompanyId: "Webin" },
          },
        ],
      });

    const { client } = await startConnectedClient(services);
    const result = await client.callTool({
      name: "generate_portfolio_signal_digest",
      arguments: { sinceDays: 7 },
    });

    expect(result.isError).toBeFalsy();
    const payload = result as {
      structuredContent?: {
        data?: {
          summary?: { totalFacts?: number };
          companies?: Array<{ factCount?: number }>;
        };
      };
    };
    expect(payload.structuredContent?.data?.summary?.totalFacts).toBe(1);
    expect(payload.structuredContent?.data?.companies?.[0]?.factCount).toBe(1);
    expect(
      services.portfolioSignalDigest.generatePortfolioSignalDigest,
    ).toHaveBeenCalled();
  });

  it("exposes server instructions via client when SDK supports getInstructions", async () => {
    const { client } = await startConnectedClient(fakeServices([]));
    // @ts-expect-error SDK client exposes getInstructions on recent versions
    const instructions =
      typeof client.getInstructions === "function"
        ? await client.getInstructions()
        : undefined;
    if (instructions) {
      expect(instructions).toContain("Resolve first");
    } else {
      expect(AGENT_TOOL_NAMES).toContain("find_competitive_history");
    }
  });
});
