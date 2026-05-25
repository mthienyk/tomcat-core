import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import type { AppConfig } from "./config/env.js";
import { buildPinoOptions, type Logger } from "./logger/index.js";
import { createAuditor } from "./audit/audit.js";
import { createGoogleHumanResolver } from "./auth/google.js";
import { createServiceTokenResolver } from "./auth/serviceToken.js";
import { createMockResolver } from "./auth/mock.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { placeholderRoleResolver } from "./auth/roleResolver.js";
import { createDbRoleResolver } from "./auth/dbRoleResolver.js";
import type { IdentityResolver } from "./auth/types.js";
import { buildConnectors } from "./connectors/registry.js";
import { buildStoreBackedConnectors } from "./connectors/storeBacked.js";
import { buildLlmRegistry } from "./llm/registry.js";
import { buildEmbeddingRegistry } from "./llm/embeddings/registry.js";
import { buildSocietyService } from "./services/society.js";
import { buildStartupsService } from "./services/startups.js";
import { buildCompanyContextService } from "./services/companyContext.js";
import { buildBpWorkflowService } from "./services/bpWorkflow.js";
import { buildPortfolioCompaniesService } from "./services/portfolioCompanies.js";
import { buildAiService } from "./services/ai.js";
import { createPgCoreStore } from "./storage/pgCoreStore.js";
import { createDb } from "./storage/pgClient.js";
import { runPgMigrations } from "./storage/pgMigrations.js";
import { bootstrapSignalHub } from "./services/signalHub/bootstrap.js";
import { buildCompetitiveHistoryService } from "./services/competitiveHistory.js";
import { buildCompanyActivitySummaryService } from "./services/companyActivitySummary.js";
import { buildFindLatestDeckService } from "./services/findLatestDeck.js";
import { buildCompanyDriveFolderService } from "./services/companyDriveFolder.js";
import { buildBoardBriefService } from "./services/boardBrief.js";
import { buildPortfolioSignalDigestService } from "./services/portfolioSignalDigest.js";
import { createSyncScheduler } from "./sync/scheduler.js";
import { createCrmMemoryIndexWorker } from "./sync/crmMemoryIndexWorker.js";
import { resolveCrmMemorySemanticLlm } from "./services/crmMemory/semanticLlm.js";
import { buildSimilarCasesService } from "./services/crmMemory/similarCases.js";
import { errorHandler } from "./api/errorHandler.js";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerMeRoutes } from "./api/routes/me.js";
import { registerAiRoutes } from "./api/routes/ai.js";
import { registerSocietyRoutes } from "./api/routes/society.js";
import {
  registerAdminRoutes,
  registerInternalRoutes,
} from "./api/routes/internal.js";
import { registerConnectorRoutes } from "./api/routes/connectors.js";
import { registerSignalRoutes } from "./api/routes/signals.js";
import { registerSignalsWebhookRoutes } from "./api/routes/signalsWebhook.js";
import { registerHubspotWebhookRoutes } from "./api/routes/hubspotWebhook.js";
import { registerRawBodyHook } from "./api/rawBody.js";
import { registerMcpHttpRoutes } from "./mcp/http.js";
import { registerMcpOauthRoutes } from "./api/routes/mcpOauth.js";
import { McpOAuthService } from "./auth/mcpOauth/service.js";
import { createMcpOauthIdentityResolver } from "./auth/mcpOauth/tokenResolver.js";

export const buildServer = async (
  config: AppConfig,
): Promise<FastifyInstance> => {
  if (
    config.env === "production" &&
    config.auth.googleOAuthClientId &&
    config.auth.allowMockAuth
  ) {
    throw new Error("Mock auth is forbidden in production");
  }
  if (config.env === "production" && config.cors.allowedOrigins.length === 0) {
    throw new Error(
      "CORS_ALLOWED_ORIGINS must be configured in production",
    );
  }
  if (
    config.env === "production" &&
    config.auth.googleOAuthClientId &&
    !config.database.url
  ) {
    throw new Error(
      "Google OAuth in production requires DATABASE_URL. placeholderRoleResolver cannot be used in production.",
    );
  }

  const app = Fastify({
    logger: buildPinoOptions(config.logLevel, { env: config.env }),
  });

  await app.register(sensible);
  await app.register(formbody);
  await app.register(cors, {
    origin:
      config.cors.allowedOrigins.length > 0 ? config.cors.allowedOrigins : true,
  });

  registerRawBodyHook(app);

  const auditor = createAuditor(app.log as unknown as Logger);

  // --- CoreStore (Postgres, optional) ---
  const pgDb = config.database.url ? createDb(config.database.url) : undefined;
  let coreStore: Awaited<ReturnType<typeof createPgCoreStore>> | undefined;
  if (pgDb) {
    await runPgMigrations(pgDb);
    coreStore = await createPgCoreStore(pgDb);
    app.log.info("CoreStore (Postgres) initialised");
  }

  // --- Connectors ---
  const httpConnectors = buildConnectors(config);
  const connectors = coreStore
    ? buildStoreBackedConnectors(coreStore, httpConnectors)
    : httpConnectors;

  // --- Auth resolvers ---
  const resolvers: IdentityResolver[] = [];
  const roleResolver = coreStore
    ? createDbRoleResolver(coreStore, {
        autoProvisionDomains: config.auth.allowedGoogleDomains,
      })
    : placeholderRoleResolver;

  // --- MCP OAuth broker (Tomcat Core acts as Authorization Server) ---
  const oauthBroker = config.auth.oauthBroker;
  let mcpOauthService: McpOAuthService | undefined;
  if (
    oauthBroker.enabled
    && coreStore
    && oauthBroker.googleWebClientId
    && oauthBroker.googleWebClientSecret
  ) {
    mcpOauthService = new McpOAuthService({
      store: coreStore.mcpOauth,
      accessTokenTtlSeconds: oauthBroker.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: oauthBroker.refreshTokenTtlSeconds,
    });
    resolvers.push(
      createMcpOauthIdentityResolver({
        service: mcpOauthService,
        resolveRole: roleResolver,
      }),
    );
  } else if (oauthBroker.enabled && !coreStore) {
    app.log.warn(
      "MCP OAuth broker requested but disabled: requires DATABASE_URL",
    );
  }

  if (config.auth.googleOAuthClientId) {
    if (!coreStore && config.env === "development") {
      app.log.warn(
        "placeholder role resolver enabled: replace before production auth rollout",
      );
    }

    resolvers.push(
      createGoogleHumanResolver({
        clientId: config.auth.googleOAuthClientId,
        allowedDomains: config.auth.allowedGoogleDomains,
        resolveRole: roleResolver,
      }),
    );
  }
  resolvers.push(
    createServiceTokenResolver({
      secret: config.auth.serviceTokenSecret,
      issuer: config.auth.serviceTokenIssuer,
      audience: config.auth.serviceTokenAudience,
      registeredClients: config.auth.serviceClients,
    }),
  );
  if (config.auth.allowMockAuth && config.env !== "production") {
    resolvers.push(createMockResolver());
    app.log.warn("mock identity resolver enabled (X-Mock-Identity header)");
  }

  const auth = createAuthMiddleware({ resolvers, auditor });

  // --- Services ---
  const society = buildSocietyService({ connectors });
  const startups = buildStartupsService({ connectors });
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
  const companyDriveFolder = buildCompanyDriveFolderService({
    connectors,
    startups,
    society,
  });

  const signalHubStack = await bootstrapSignalHub({
    config,
    startups,
    ...(pgDb !== undefined ? { pgDb } : {}),
    onInfo: (message) => {
      app.log.info(message);
    },
  });
  signalHubStack.start();
  const signalHubService = signalHubStack.signalHub;

  const boardBrief = buildBoardBriefService({
    connectors,
    startups,
    society,
    signalHub: signalHubService,
    signalHubEnabled: config.signalHub.enabled,
  });

  const portfolioSignalDigest = buildPortfolioSignalDigestService({
    connectors,
    startups,
    society,
    signalHub: signalHubService,
    signalHubEnabled: config.signalHub.enabled,
  });

  const bpWorkflow = buildBpWorkflowService({ connectors, society });
  const portfolioCompanies = buildPortfolioCompaniesService({
    connectors,
    society,
  });

  // --- Sync scheduler (when CoreStore available) ---
  let syncScheduler: ReturnType<typeof createSyncScheduler> | undefined;
  if (coreStore) {
    const logger = app.log as unknown as Logger;
    syncScheduler = createSyncScheduler(
      {
        store: coreStore,
        connectors: httpConnectors,
        logger,
      },
      pgDb!,
      coreStore,
      {
        overlapGraceMinutes: config.sync.overlapGraceMinutes,
        queuePollIntervalMs: config.sync.queuePollIntervalMs,
        queueBatchSize: config.sync.queueBatchSize,
        queueStaleJobMs: config.sync.queueStaleJobMs,
        queueRetryDelayMs: config.sync.queueRetryDelayMs,
        reconcileIntervalMs: config.sync.reconcileIntervalMs,
        reconcileLookbackMs: config.sync.reconcileLookbackMs,
      },
    );
    syncScheduler.start();
  }

  // --- LLM + AI routes ---
  const llmRegistry = buildLlmRegistry(config);
  const embeddingRegistry = buildEmbeddingRegistry(config);

  let similarCases: ReturnType<typeof buildSimilarCasesService> | undefined;
  let crmMemoryIndexTimer: ReturnType<typeof setInterval> | undefined;

  if (coreStore && embeddingRegistry.defaultProvider()) {
    similarCases = buildSimilarCasesService({
      store: coreStore,
      startups,
      embeddings: embeddingRegistry.defaultProvider(),
    });
  }

  if (coreStore && llmRegistry.hasAnyProvider()) {
    const semanticLlm = resolveCrmMemorySemanticLlm(config, llmRegistry);

    const crmMemoryWorker = createCrmMemoryIndexWorker({
      store: coreStore,
      connectors,
      embeddingRegistry,
      logger: app.log as unknown as Logger,
      config: {
        enabled: config.crmMemory.indexEnabled,
        batchSize: config.crmMemory.indexBatchSize,
        concurrency: config.crmMemory.indexConcurrency,
        semanticLlm,
      },
    });

    crmMemoryIndexTimer = setInterval(() => {
      void crmMemoryWorker.runOnce().catch((err) => {
        app.log.error({ err }, "crm_memory_index_batch_failed");
      });
    }, config.crmMemory.indexIntervalMs);
    setTimeout(() => {
      void crmMemoryWorker.runOnce().catch((err) => {
        app.log.error({ err }, "crm_memory_index_batch_failed");
      });
    }, 10_000);
  }

  app.addHook("onClose", async () => {
    if (crmMemoryIndexTimer !== undefined) {
      clearInterval(crmMemoryIndexTimer);
    }
    syncScheduler?.stop();
    if (coreStore) {
      const failed = await coreStore.failAllRunningSyncRuns("replica_shutdown");
      if (failed > 0) {
        app.log.warn({ failed }, "marked_running_sync_runs_failed_on_shutdown");
      }
    }
    signalHubStack.stop();
    await pgDb?.end();
  });

  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app, connectors, coreStore);
  registerMeRoutes(app, auth);

  if (
    mcpOauthService
    && oauthBroker.googleWebClientId
    && oauthBroker.googleWebClientSecret
    && oauthBroker.issuerUrl
  ) {
    registerMcpOauthRoutes(app, {
      service: mcpOauthService,
      resolveRole: roleResolver,
      googleWebClientId: oauthBroker.googleWebClientId,
      googleWebClientSecret: oauthBroker.googleWebClientSecret,
      allowedGoogleDomains: config.auth.allowedGoogleDomains,
      issuerUrl: oauthBroker.issuerUrl,
      allowedRedirectUriPrefixes: oauthBroker.allowedRedirectUriPrefixes,
      registerRateLimitPerMinute: oauthBroker.registerRateLimitPerMinute,
    });
    app.log.info("MCP OAuth broker enabled at /oauth/* and /.well-known/*");
  }

  if (config.auth.googleOAuthClientId || config.auth.allowMockAuth || mcpOauthService) {
    registerMcpHttpRoutes(app, {
      services: {
        startups,
        society,
        companyContext,
        signalHub: signalHubService,
        competitiveHistory,
        companyActivitySummary,
        findLatestDeck,
        companyDriveFolder,
        boardBrief,
        portfolioSignalDigest,
        bpWorkflow,
        portfolioCompanies,
        similarCases,
      },
      auditor,
      auth,
      signalHubEnabled: config.signalHub.enabled,
      ...(oauthBroker.issuerUrl
        ? { resourceMetadataBaseUrl: oauthBroker.issuerUrl }
        : {}),
    });
    app.log.info("MCP Streamable HTTP enabled at /mcp");
  }

  registerSocietyRoutes(app, auth, society);
  registerInternalRoutes(app, auth, boardBrief);
  registerConnectorRoutes(app, auth, startups);
  registerSignalRoutes(app, auth, signalHubService);
  registerSignalsWebhookRoutes(
    app,
    signalHubStack.store,
    signalHubStack.guardians,
    config.signalHub.unipileWebhookSecret,
  );

  if (coreStore) {
    const webhookPublicUrl =
      config.connectors.hubspotWebhookPublicUrl
      ?? (config.auth.oauthBroker.issuerUrl
        ? `${config.auth.oauthBroker.issuerUrl.replace(/\/$/, "")}/webhooks/hubspot`
        : undefined);

    registerHubspotWebhookRoutes(app, {
      store: coreStore,
      clientSecret: config.connectors.hubspotWebhookClientSecret,
      ...(webhookPublicUrl ? { publicUrl: webhookPublicUrl } : {}),
      logger: app.log as unknown as Logger,
    });
  }

  if (coreStore) {
    registerAdminRoutes(app, auth, coreStore);
  }

  if (llmRegistry.hasAnyProvider()) {
    const ai = buildAiService({
      llmRegistry,
      startups,
      society,
      companyContext,
      signalHub: signalHubService,
      competitiveHistory,
      companyActivitySummary,
      findLatestDeck,
      companyDriveFolder,
      boardBrief,
      portfolioSignalDigest,
      bpWorkflow,
      portfolioCompanies,
      similarCases,
      auditor,
    });
    registerAiRoutes(app, auth, ai);
  } else {
    app.log.warn(
      "No LLM provider configured. /ai/query disabled. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY to enable.",
    );
  }

  return app;
};
