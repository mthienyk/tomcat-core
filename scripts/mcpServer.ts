import "dotenv/config";
import pino from "pino";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { buildStoreBackedConnectors } from "../src/connectors/storeBacked.js";
import { createDb } from "../src/storage/pgClient.js";
import { runPgMigrations } from "../src/storage/pgMigrations.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import { buildSocietyService } from "../src/services/society.js";
import { buildStartupsService } from "../src/services/startups.js";
import { buildCompanyContextService } from "../src/services/companyContext.js";
import { buildCompetitiveHistoryService } from "../src/services/competitiveHistory.js";
import { buildCompanyActivitySummaryService } from "../src/services/companyActivitySummary.js";
import { buildFindLatestDeckService } from "../src/services/findLatestDeck.js";
import { buildCompanyDriveFolderService } from "../src/services/companyDriveFolder.js";
import { buildBpWorkflowService } from "../src/services/bpWorkflow.js";
import { buildPortfolioCompaniesService } from "../src/services/portfolioCompanies.js";
import { buildBoardBriefService } from "../src/services/boardBrief.js";
import { buildPortfolioSignalDigestService } from "../src/services/portfolioSignalDigest.js";
import { buildEmbeddingRegistry } from "../src/llm/embeddings/registry.js";
import { buildSimilarCasesService } from "../src/services/crmMemory/similarCases.js";
import { bootstrapSignalHub } from "../src/services/signalHub/bootstrap.js";
import { createAuditor } from "../src/audit/audit.js";
import { createMcpCallerResolver } from "../src/auth/mcpCaller.js";
import { buildMcpAgentServer } from "../src/mcp/server.js";

const logger = pino(
  { level: process.env["LOG_LEVEL"] ?? "info", base: { service: "tomcat-mcp" } },
  pino.destination(2),
);

const main = async (): Promise<void> => {
  const config = loadConfig();
  const httpConnectors = buildConnectors(config);
  let connectors = httpConnectors;
  let coreStore: Awaited<ReturnType<typeof createPgCoreStore>> | undefined;
  if (config.database.url) {
    const pgDb = createDb(config.database.url);
    await runPgMigrations(pgDb);
    coreStore = await createPgCoreStore(pgDb);
    connectors = buildStoreBackedConnectors(coreStore, httpConnectors);
    logger.info("MCP using CoreStore-backed connectors");
  }
  const startups = buildStartupsService({ connectors });
  const society = buildSocietyService({ connectors });
  const companyContext = buildCompanyContextService({
    connectors,
    startups,
    society,
  });
  const competitiveHistory = buildCompetitiveHistoryService({ startups });
  const companyActivitySummary = buildCompanyActivitySummaryService({ startups });
  const findLatestDeck = buildFindLatestDeckService({
    connectors,
    startups,
    society,
  });

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
    signalHubEnabled: config.signalHub.enabled,
  });
  const portfolioSignalDigest = buildPortfolioSignalDigestService({
    connectors,
    startups,
    society,
    signalHub: signalHubStack.signalHub,
    signalHubEnabled: config.signalHub.enabled,
  });

  const bpWorkflow = buildBpWorkflowService({ connectors, society });
  const portfolioCompanies = buildPortfolioCompaniesService({
    connectors,
    society,
  });

  const embeddingRegistry = buildEmbeddingRegistry(config);
  let similarCases: ReturnType<typeof buildSimilarCasesService> | undefined;
  if (coreStore && embeddingRegistry.defaultProvider()) {
    similarCases = buildSimilarCasesService({
      store: coreStore,
      startups,
      embeddings: embeddingRegistry.defaultProvider(),
    });
  }

  const services = {
    startups,
    society,
    companyContext,
    signalHub: signalHubStack.signalHub,
    competitiveHistory,
    companyActivitySummary,
    findLatestDeck,
    companyDriveFolder,
    boardBrief,
    portfolioSignalDigest,
    bpWorkflow,
    portfolioCompanies,
    similarCases,
  };
  const auditor = createAuditor(logger);
  const resolveCaller = createMcpCallerResolver(config, coreStore);

  const server = buildMcpAgentServer({
    services,
    resolveCaller,
    auditor,
    signalHubEnabled: config.signalHub.enabled,
  });

  const shutdown = (): void => {
    signalHubStack.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const bootCaller = await resolveCaller();
  logger.info(
    { email: bootCaller.email, role: bootCaller.role },
    "Tomcat MCP ready on stdio",
  );
};

main().catch((error: unknown) => {
  logger.error({ err: error }, "MCP server failed to start");
  process.exit(1);
});
