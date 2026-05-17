import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const minimalEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  SERVICE_TOKEN_SECRET: "x".repeat(32),
  ...overrides,
});

describe("loadConfig", () => {
  it("loads with minimal valid env", () => {
    const cfg = loadConfig(minimalEnv());
    expect(cfg.env).toBe("development");
    expect(cfg.port).toBe(4000);
    expect(cfg.auth.allowedGoogleDomains).toEqual(["tomcat.eu"]);
  });

  it("rejects short SERVICE_TOKEN_SECRET", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "development", SERVICE_TOKEN_SECRET: "short" }),
    ).toThrow();
  });

  it("forbids ALLOW_MOCK_AUTH=true in production", () => {
    expect(() =>
      loadConfig(
        minimalEnv({ NODE_ENV: "production", ALLOW_MOCK_AUTH: "true" }),
      ),
    ).toThrow(/ALLOW_MOCK_AUTH/);
  });

  it("parses SERVICE_CLIENTS into structured list", () => {
    const cfg = loadConfig(
      minimalEnv({
        SERVICE_CLIENTS: "society:society.read|society.write,team-mcp:ai.query",
      }),
    );
    expect(cfg.auth.serviceClients).toEqual([
      { clientId: "society", scopes: ["society.read", "society.write"] },
      { clientId: "team-mcp", scopes: ["ai.query"] },
    ]);
  });

  it("rejects malformed SERVICE_CLIENTS entries", () => {
    expect(() =>
      loadConfig(minimalEnv({ SERVICE_CLIENTS: "bad-entry-no-colon" })),
    ).toThrow(/Invalid SERVICE_CLIENTS/);
  });

  it("supports Google as an LLM provider", () => {
    const cfg = loadConfig(
      minimalEnv({
        GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
        LLM_DEFAULT_PROVIDER: "google",
        LLM_DEFAULT_MODEL: "gemini-3.1-pro-preview",
      }),
    );

    expect(cfg.llm.defaultProvider).toBe("google");
    expect(cfg.llm.googleGenerativeAiApiKey).toBe("google-key");
  });

  it("supports Google Drive service account file credentials", () => {
    const cfg = loadConfig(
      minimalEnv({
        GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE: ".secrets/service-account.json",
      }),
    );

    expect(cfg.connectors.driveServiceAccountFile).toBe(
      ".secrets/service-account.json",
    );
  });

  it("parses CORS allowed origins", () => {
    const cfg = loadConfig(
      minimalEnv({
        CORS_ALLOWED_ORIGINS:
          "https://society.tomcat.eu,https://admin.tomcat.eu",
      }),
    );
    expect(cfg.cors.allowedOrigins).toEqual([
      "https://society.tomcat.eu",
      "https://admin.tomcat.eu",
    ]);
  });

  it("defaults signal store driver to sqlite", () => {
    const cfg = loadConfig(minimalEnv());
    expect(cfg.signalHub.storeDriver).toBe("sqlite");
  });

  it("includes database url when set", () => {
    const cfg = loadConfig(
      minimalEnv({ DATABASE_URL: "postgresql://localhost/tomcat" }),
    );
    expect(cfg.database.url).toBe("postgresql://localhost/tomcat");
  });

  it("database url is undefined when not set", () => {
    const cfg = loadConfig(minimalEnv());
    expect(cfg.database.url).toBeUndefined();
  });

  it("rejects postgres signal store until implemented", () => {
    expect(() =>
      loadConfig(minimalEnv({ SIGNAL_STORE_DRIVER: "postgres" })),
    ).toThrow(/postgres/);
  });

  it("allows postgres signal store when DATABASE_URL is set", () => {
    const cfg = loadConfig(
      minimalEnv({
        SIGNAL_STORE_DRIVER: "postgres",
        DATABASE_URL: "postgresql://localhost/tomcat",
      }),
    );
    expect(cfg.signalHub.storeDriver).toBe("postgres");
    expect(cfg.database.url).toBe("postgresql://localhost/tomcat");
  });
});
