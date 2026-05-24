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
import { buildSocietyService } from "./services/society.js";
import { buildStartupsService } from "./services/startups.js";
import { buildCompanyContextService } from "./services/companyContext.js";
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
      { overlapGraceMinutes: config.sync.overlapGraceMinutes },
    );
    syncScheduler.start();
  }

  app.addHook("onClose", async () => {
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

  // --- LLM + AI routes ---
  const llmRegistry = buildLlmRegistry(config);

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
