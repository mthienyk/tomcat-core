import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import type { AppConfig } from "../../src/config/env.js";

const baseProdConfig = (): AppConfig => ({
  env: "production",
  port: 4000,
  logLevel: "info",
  auth: {
    allowedGoogleDomains: ["tomcat.eu"],
    googleOAuthClientId: undefined,
    serviceTokenSecret: "x".repeat(48),
    serviceTokenIssuer: "tomcat-core",
    serviceTokenAudience: "tomcat-core",
    serviceClients: [{ clientId: "society", scopes: ["society.read"] }],
    allowMockAuth: false,
  },
  connectors: {
    hubspotToken: undefined,
    driveServiceAccountJson: undefined,
    driveServiceAccountFile: undefined,
    driveSharedDriveId: undefined,
    mondayToken: undefined,
  },
  signalHub: {
    enabled: false,
    serperApiKey: undefined,
    unipileDsn: undefined,
    unipileApiKey: undefined,
    unipileWebhookSecret: undefined,
    storeDriver: "sqlite",
    storePath: ".data/test-signal-hub.db",
    unipileDailyQuota: 60,
  },
  llm: {
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    googleGenerativeAiApiKey: undefined,
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-6",
  },
  cors: {
    allowedOrigins: [],
  },
  database: {
    url: undefined,
  },
});

describe("server production security guards", () => {
  it("refuses to boot in production without CORS allowlist", async () => {
    await expect(buildServer(baseProdConfig())).rejects.toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it("refuses Google OAuth without DATABASE_URL in production", async () => {
    const config = baseProdConfig();
    config.cors.allowedOrigins = ["https://society.tomcat.eu"];
    config.auth.googleOAuthClientId = "google-client-id";
    await expect(buildServer(config)).rejects.toThrow(
      /placeholderRoleResolver|DATABASE_URL/,
    );
  });
});
