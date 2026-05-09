import "dotenv/config";
import pino from "pino";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { buildSocietyService } from "../src/services/society.js";
import { buildStartupsService } from "../src/services/startups.js";
import { buildBriefsService } from "../src/services/briefs.js";
import { createAuditor } from "../src/audit/audit.js";
import { buildMcpAgentServer } from "../src/mcp/server.js";
import type { Identity } from "../src/domain/identity.js";

// Logs go to stderr so they don't pollute the stdio MCP channel.
const logger = pino(
  { level: process.env["LOG_LEVEL"] ?? "info", base: { service: "tomcat-mcp" } },
  pino.destination(2),
);

const localOperator: Identity = {
  kind: "human",
  email: process.env["MCP_OPERATOR_EMAIL"] ?? "local@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
  investorTier: undefined,
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const connectors = buildConnectors(config);
  const services = {
    startups: buildStartupsService({ connectors }),
    briefs: buildBriefsService({ connectors }),
    society: buildSocietyService({ connectors }),
  };
  const auditor = createAuditor(logger);

  const server = buildMcpAgentServer({
    services,
    caller: localOperator,
    auditor,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Tomcat MCP server ready on stdio");
};

main().catch((error: unknown) => {
  logger.error({ err: error }, "MCP server failed to start");
  process.exit(1);
});
