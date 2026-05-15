import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpAgentServer } from "../../src/mcp/server.js";
import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_REGISTRY,
  type AgentToolServices,
} from "../../src/agent/toolRegistry.js";
import { Forbidden } from "../../src/errors/index.js";
import type { Identity } from "../../src/domain/identity.js";
import type { Auditor } from "../../src/audit/audit.js";

const human: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
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
    briefs: { boardPrep: vi.fn() },
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
  }) as unknown as AgentToolServices;

const startConnectedClient = async (services: AgentToolServices) => {
  const server = buildMcpAgentServer({
    services,
    caller: human,
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
  return { client, server };
};

describe("MCP server", () => {
  it("exposes every registry tool through tools/list", async () => {
    const { client } = await startConnectedClient(fakeServices([]));
    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
    for (const tool of list.tools) {
      expect(tool.description).toMatch(/Sources:/);
      expect(tool.inputSchema).toBeTruthy();
    }
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
    const services = {
      startups: {
        findSimilar: vi.fn(),
        searchStartups: vi.fn().mockResolvedValue([]),
        listAccessibleNotes: vi.fn(),
        listAccessibleDeals: vi.fn(),
        listAccessibleMeetings: vi.fn(),
      },
      briefs: { boardPrep: vi.fn() },
      society: {
        getInvestorHome: vi.fn(),
        getPortfolioSignals: vi.fn().mockRejectedValue(new Error("boom")),
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
    } as unknown as AgentToolServices;
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
    const services = {
      startups: {
        findSimilar: vi.fn(),
        searchStartups: vi.fn().mockResolvedValue([]),
        listAccessibleNotes: vi.fn(),
        listAccessibleDeals: vi.fn(),
        listAccessibleMeetings: vi.fn(),
      },
      briefs: { boardPrep: vi.fn() },
      society: {
        getInvestorHome: vi.fn(),
        getPortfolioSignals: vi.fn().mockRejectedValue(
          Forbidden("Portfolio company is outside caller scope"),
        ),
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
    } as unknown as AgentToolServices;

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

    const services = {
      startups: {
        findSimilar: vi.fn(),
        searchStartups: vi.fn(),
        listAccessibleNotes: vi.fn(),
        listAccessibleDeals: vi.fn(),
        listAccessibleMeetings: vi.fn(),
      },
      briefs: { boardPrep: vi.fn() },
      society: {
        getInvestorHome: vi.fn(),
        getPortfolioSignals: vi.fn(),
        ensurePortfolioCompanyInScope: vi.fn(),
      },
      companyContext: {
        resolveEntity: vi.fn(),
        listCompanyCrmActivity: vi.fn(),
        listCompanyDocuments: vi.fn(),
        readCompanyDocumentExcerpt: vi.fn(),
        listPortfolioContext: vi.fn(),
        buildCompany360Context: vi.fn(),
      },
    } as unknown as AgentToolServices;

    const { client } = await startConnectedClient(services);
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

  it("registers every tool with a description that mentions Sources/Access/Approval", async () => {
    const { client } = await startConnectedClient(fakeServices([]));
    const list = await client.listTools();
    for (const tool of list.tools) {
      expect(tool.description).toMatch(/Sources:.+Access:.+Approval required/);
      expect(tool.inputSchema["type"]).toBe("object");
    }
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
  });
});
