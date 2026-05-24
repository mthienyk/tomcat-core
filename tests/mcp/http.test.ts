import { describe, expect, it, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../../src/server.js";
import type { AppConfig } from "../../src/config/env.js";
import { AGENT_TOOL_NAMES } from "../../src/agent/toolRegistry.js";

const mockIdentityHeader = JSON.stringify({
  kind: "human",
  email: "mcp@tomcat.eu",
  role: "internal_team",
});

const testConfig = (): AppConfig => ({
  env: "development",
  port: 0,
  logLevel: "silent",
  auth: {
    allowedGoogleDomains: ["tomcat.eu"],
    googleOAuthClientId: undefined,
    serviceTokenSecret: "x".repeat(48),
    serviceTokenIssuer: "tomcat-core",
    serviceTokenAudience: "tomcat-core",
    serviceClients: [],
    allowMockAuth: true,
    oauthBroker: {
      enabled: false,
      googleWebClientId: undefined,
      googleWebClientSecret: undefined,
      issuerUrl: undefined,
      allowedRedirectUriPrefixes: [],
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 86400,
      registerRateLimitPerMinute: 30,
    },
  },
  connectors: {
    hubspotToken: undefined,
    driveServiceAccountJson: undefined,
    driveServiceAccountFile: undefined,
    driveSharedDriveId: undefined,
    mondayToken: undefined,
  },
  signalHub: {
    serperApiKey: undefined,
    unipileDsn: undefined,
    unipileApiKey: undefined,
    unipileWebhookSecret: undefined,
    storeDriver: "sqlite",
    storePath: ".data/test-mcp-http.db",
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
  sync: {
    overlapGraceMinutes: 20,
  },
});

const listen = async (): Promise<{
  app: Awaited<ReturnType<typeof buildServer>>;
  baseUrl: string;
}> => {
  const app = await buildServer(testConfig());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return { app, baseUrl: `http://127.0.0.1:${String(address.port)}` };
};

describe("MCP HTTP /mcp", () => {
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("rejects unauthenticated requests", async () => {
    const started = await listen();
    app = started.app;

    const response = await fetch(`${started.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("lists registry tools over Streamable HTTP", async () => {
    const started = await listen();
    app = started.app;

    const transport = new StreamableHTTPClientTransport(
      new URL(`${started.baseUrl}/mcp`),
      {
        requestInit: {
          headers: {
            "X-Mock-Identity": mockIdentityHeader,
          },
        },
      },
    );
    const client = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
    await client.close();
  });

  it("allows CORS preflight without authentication", async () => {
    const started = await listen();
    app = started.app;

    const response = await fetch(`${started.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect([204, 200]).toContain(response.status);
  });

  it("rejects service tokens even when scoped for ai.query", async () => {
    const started = await listen();
    app = started.app;

    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode("x".repeat(48));
    const token = await new SignJWT({
      scope: "ai.query briefs.write",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("team-mcp")
      .setIssuer("tomcat-core")
      .setAudience("tomcat-core")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    const response = await fetch(`${started.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
