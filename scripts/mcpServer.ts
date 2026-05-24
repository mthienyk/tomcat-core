import "dotenv/config";
import pino from "pino";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { buildSocietyService } from "../src/services/society.js";
import { buildStartupsService } from "../src/services/startups.js";
import { buildCompanyContextService } from "../src/services/companyContext.js";
import { buildCompetitiveHistoryService } from "../src/services/competitiveHistory.js";
import { buildCompanyDriveFolderService } from "../src/services/companyDriveFolder.js";
import { buildBoardBriefService } from "../src/services/boardBrief.js";
import { buildPortfolioSignalDigestService } from "../src/services/portfolioSignalDigest.js";
import { bootstrapSignalHub } from "../src/services/signalHub/bootstrap.js";
import { createAuditor } from "../src/audit/audit.js";
import { resolveMcpCaller } from "../src/auth/mcpCaller.js";
import { buildMcpAgentServer } from "../src/mcp/server.js";

const logger = pino(
  { level: process.env["LOG_LEVEL"] ?? "info", base: { service: "tomcat-mcp" } },
  pino.destination(2),
);

const main = async (): Promise<void> => {
  const config = loadConfig();
  const connectors = buildConnectors(config);
  const startups = buildStartupsService({ connectors });
  const society = buildSocietyService({ connectors });
  const companyContext = buildCompanyContextService({
    connectors,
    startups,
    society,
  });
  const competitiveHistory = buildCompetitiveHistoryService({ startups });

  const signalHubStack = await bootstrapSignalHub({
    config,
    startups,
    onInfo: (message) => logger.info(message),
  });
  signalHubStack.start();

  const companyDriveFolder = buildCompanyDriveFolderService({
    connectors,
    startups,
    society,
  });
  const boardBrief = buildBoardBriefService({
    connectors,
    startups,
    society,
    signalHub: signalHubStack.signalHub,
  });
  const portfolioSignalDigest = buildPortfolioSignalDigestService({
    connectors,
    startups,
    society,
    signalHub: signalHubStack.signalHub,
  });

  const services = {
    startups,
    society,
    companyContext,
    signalHub: signalHubStack.signalHub,
    competitiveHistory,
    companyDriveFolder,
    boardBrief,
    portfolioSignalDigest,
  };
  const auditor = createAuditor(logger);

  const server = buildMcpAgentServer({
    services,
    resolveCaller: resolveMcpCaller,
    auditor,
  });

  const shutdown = (): void => {
    signalHubStack.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const bootCaller = await resolveMcpCaller();
  logger.info(
    { email: bootCaller.email, role: bootCaller.role },
    "Tomcat MCP ready on stdio",
  );
};

main().catch((error: unknown) => {
  logger.error({ err: error }, "MCP server failed to start");
  process.exit(1);
});
