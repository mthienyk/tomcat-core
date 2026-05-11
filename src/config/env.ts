import { z } from "zod";

const csv = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ServiceClientSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
});

const parseServiceClients = (
  raw: string | undefined,
): z.infer<typeof ServiceClientSchema>[] =>
  csv(raw).map((entry) => {
    const [clientId, scopesPart] = entry.split(":");
    if (!clientId || !scopesPart) {
      throw new Error(
        `Invalid SERVICE_CLIENTS entry "${entry}". Expected "clientId:scope1|scope2".`,
      );
    }
    const scopes = scopesPart.split("|").map((s) => s.trim()).filter(Boolean);
    return ServiceClientSchema.parse({ clientId: clientId.trim(), scopes });
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  ALLOWED_GOOGLE_DOMAINS: z.string().default("tomcat.eu"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),

  SERVICE_TOKEN_SECRET: z
    .string()
    .min(32, "SERVICE_TOKEN_SECRET must be at least 32 chars"),
  SERVICE_TOKEN_ISSUER: z.string().min(1).default("tomcat-core"),
  SERVICE_TOKEN_AUDIENCE: z.string().min(1).default("tomcat-core"),
  SERVICE_CLIENTS: z.string().optional(),

  ALLOW_MOCK_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  HUBSPOT_API_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE: z.string().optional(),
  // Optional: scope Drive searches to a specific Shared Drive.
  // Add the service account (tomcat-ai-drive-reader@tomcat-ai-backend.iam.gserviceaccount.com)
  // as a member of the Shared Drive once — all current and future content becomes accessible.
  GOOGLE_DRIVE_SHARED_DRIVE_ID: z.string().optional(),
  MONDAY_API_TOKEN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  LLM_DEFAULT_PROVIDER: z
    .enum(["anthropic", "openai", "google"])
    .default("anthropic"),
  LLM_DEFAULT_MODEL: z.string().default("claude-sonnet-4-6"),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export type AppConfig = {
  env: "development" | "test" | "production";
  port: number;
  logLevel: RawEnv["LOG_LEVEL"];
  auth: {
    allowedGoogleDomains: string[];
    googleOAuthClientId: string | undefined;
    serviceTokenSecret: string;
    serviceTokenIssuer: string;
    serviceTokenAudience: string;
    serviceClients: { clientId: string; scopes: string[] }[];
    allowMockAuth: boolean;
  };
    connectors: {
      hubspotToken: string | undefined;
      driveServiceAccountJson: string | undefined;
      driveServiceAccountFile: string | undefined;
      driveSharedDriveId: string | undefined;
      mondayToken: string | undefined;
    };
  llm: {
    anthropicApiKey: string | undefined;
    openaiApiKey: string | undefined;
    googleGenerativeAiApiKey: string | undefined;
    defaultProvider: "anthropic" | "openai" | "google";
    defaultModel: string;
  };
  cors: {
    allowedOrigins: string[];
  };
};

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = EnvSchema.parse(source);

  if (parsed.NODE_ENV === "production" && parsed.ALLOW_MOCK_AUTH) {
    throw new Error("ALLOW_MOCK_AUTH must be false in production.");
  }

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    auth: {
      allowedGoogleDomains: csv(parsed.ALLOWED_GOOGLE_DOMAINS),
      googleOAuthClientId: parsed.GOOGLE_OAUTH_CLIENT_ID,
      serviceTokenSecret: parsed.SERVICE_TOKEN_SECRET,
      serviceTokenIssuer: parsed.SERVICE_TOKEN_ISSUER,
      serviceTokenAudience: parsed.SERVICE_TOKEN_AUDIENCE,
      serviceClients: parseServiceClients(parsed.SERVICE_CLIENTS),
      allowMockAuth: parsed.ALLOW_MOCK_AUTH,
    },
    connectors: {
      hubspotToken: parsed.HUBSPOT_API_TOKEN,
      driveServiceAccountJson: parsed.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
      driveServiceAccountFile: parsed.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE,
      driveSharedDriveId: parsed.GOOGLE_DRIVE_SHARED_DRIVE_ID,
      mondayToken: parsed.MONDAY_API_TOKEN,
    },
    llm: {
      anthropicApiKey: parsed.ANTHROPIC_API_KEY,
      openaiApiKey: parsed.OPENAI_API_KEY,
      googleGenerativeAiApiKey: parsed.GOOGLE_GENERATIVE_AI_API_KEY,
      defaultProvider: parsed.LLM_DEFAULT_PROVIDER,
      defaultModel: parsed.LLM_DEFAULT_MODEL,
    },
    cors: {
      allowedOrigins: csv(parsed.CORS_ALLOWED_ORIGINS),
    },
  };
};
