import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpAgentServer } from "../../src/mcp/server.js";
import {
  AGENT_TOOL_NAMES,
  type AgentToolServices,
} from "../../src/agent/toolRegistry.js";
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
    startups: { findSimilar: vi.fn(), listAccessibleNotes: vi.fn() },
    briefs: { boardPrep: vi.fn() },
    society: {
      getInvestorHome: vi.fn(),
      getPortfolioSignals: vi.fn().mockResolvedValue(signals),
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
  });

  it("returns a structured error when the underlying service throws", async () => {
    const services = {
      startups: { findSimilar: vi.fn(), listAccessibleNotes: vi.fn() },
      briefs: { boardPrep: vi.fn() },
      society: {
        getInvestorHome: vi.fn(),
        getPortfolioSignals: vi.fn().mockRejectedValue(new Error("boom")),
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
  });
});
