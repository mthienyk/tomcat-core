import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import type { AppConfig } from "./config/env.js";
import { buildPinoOptions, type Logger } from "./logger/index.js";
import { createAuditor } from "./audit/audit.js";
import { createGoogleHumanResolver } from "./auth/google.js";
import { createServiceTokenResolver } from "./auth/serviceToken.js";
import { createMockResolver } from "./auth/mock.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { placeholderRoleResolver } from "./auth/roleResolver.js";
import type { IdentityResolver } from "./auth/types.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildConnectors } from "./connectors/registry.js";
import { createSerperConnector, createUnconfiguredSerperConnector } from "./connectors/serper.js";
import { createUnipileConnector, createUnconfiguredUnipileConnector } from "./connectors/unipile.js";
import { buildLlmRegistry } from "./llm/registry.js";
import { buildSocietyService } from "./services/society.js";
import { buildStartupsService } from "./services/startups.js";
import { buildBriefsService } from "./services/briefs.js";
import { buildCompanyContextService } from "./services/companyContext.js";
import { buildAiService } from "./services/ai.js";
import { createSqliteSignalStore } from "./storage/sqliteSignalStore.js";
import { createGuardianRegistry } from "./services/signalHub/accountGuardian.js";
import { createEntityResolver } from "./services/signalHub/resolver.js";
import { createSignalQueue } from "./services/signalHub/queue.js";
import { buildSignalHubService } from "./services/signalHub/index.js";
import { errorHandler } from "./api/errorHandler.js";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerMeRoutes } from "./api/routes/me.js";
import { registerAiRoutes } from "./api/routes/ai.js";
import { registerSocietyRoutes } from "./api/routes/society.js";
import { registerInternalRoutes } from "./api/routes/internal.js";
import { registerConnectorRoutes } from "./api/routes/connectors.js";
import { registerSignalRoutes } from "./api/routes/signals.js";
import { registerSignalsWebhookRoutes } from "./api/routes/signalsWebhook.js";

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
  if (config.env === "production" && config.auth.googleOAuthClientId) {
    throw new Error(
      "placeholderRoleResolver cannot be used in production. Configure a real role resolver.",
    );
  }

  const app = Fastify({
    logger: buildPinoOptions(config.logLevel, { env: config.env }),
  });

  await app.register(sensible);
  await app.register(cors, {
    origin:
      config.cors.allowedOrigins.length > 0 ? config.cors.allowedOrigins : true,
  });

  const auditor = createAuditor(app.log as unknown as Logger);

  const resolvers: IdentityResolver[] = [];
  if (config.auth.googleOAuthClientId) {
    resolvers.push(
      createGoogleHumanResolver({
        clientId: config.auth.googleOAuthClientId,
        allowedDomains: config.auth.allowedGoogleDomains,
        resolveRole: placeholderRoleResolver,
      }),
    );
    if (config.env === "development") {
      app.log.warn(
        "placeholder role resolver enabled: replace before production auth rollout",
      );
    }
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
  const connectors = buildConnectors(config);
  const society = buildSocietyService({ connectors });
  const startups = buildStartupsService({ connectors });
  const briefs = buildBriefsService({ connectors });
  const companyContext = buildCompanyContextService({
    connectors,
    startups,
    society,
  });

  // Signal Hub
  const { signalHub: shConfig } = config;
  mkdirSync(dirname(shConfig.storePath) === "." ? ".data" : dirname(shConfig.storePath), {
    recursive: true,
  });
  const signalStore = createSqliteSignalStore(shConfig.storePath);
  const guardianRegistry = createGuardianRegistry(signalStore);

  // Pre-load guardian state from DB for any previously registered accounts
  void signalStore.listUnipileAccounts().then((accounts) => {
    for (const account of accounts) {
      if (account.state !== "killed") {
        guardianRegistry.getOrCreate(account.accountId, account.label, account.dailyQuota);
      }
    }
  });

  const serper = shConfig.serperApiKey
    ? createSerperConnector(shConfig.serperApiKey)
    : createUnconfiguredSerperConnector();

  const unipile =
    shConfig.unipileDsn && shConfig.unipileApiKey
      ? createUnipileConnector(shConfig.unipileDsn, shConfig.unipileApiKey)
      : createUnconfiguredUnipileConnector();

  const signalQueue = createSignalQueue({
    store: signalStore,
    serper,
    unipile,
    guardians: guardianRegistry,
  });

  const entityResolver = createEntityResolver(signalStore, startups);

  const signalHubService = buildSignalHubService({
    store: signalStore,
    queue: signalQueue,
    resolver: entityResolver,
    guardians: guardianRegistry,
  });

  signalQueue.start();

  const llmRegistry = buildLlmRegistry(config);

  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app, connectors);
  registerMeRoutes(app, auth);
  registerSocietyRoutes(app, auth, society);
  registerInternalRoutes(app, auth, briefs);
  registerConnectorRoutes(app, auth, startups);
  registerSignalRoutes(app, auth, signalHubService);
  registerSignalsWebhookRoutes(
    app,
    signalStore,
    guardianRegistry,
    shConfig.unipileWebhookSecret,
  );

  if (llmRegistry.hasAnyProvider()) {
    const ai = buildAiService({
      llmRegistry,
      startups,
      briefs,
      society,
      companyContext,
      signalHub: signalHubService,
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
