import { createDb } from "../storage/pgClient.js";
import { createPgCoreStore } from "../storage/pgCoreStore.js";
import { loadConfig } from "../config/env.js";
import { createDbRoleResolver } from "./dbRoleResolver.js";
import { placeholderRoleResolver } from "./roleResolver.js";
import type { HumanIdentity } from "../domain/identity.js";
import { resolveStoredGoogleIdToken } from "./googleOAuthSession.js";
import { verifyGoogleIdToken } from "./verifyGoogleIdToken.js";

export const resolveMcpCaller = async (): Promise<HumanIdentity> => {
  const config = loadConfig();
  const clientId = config.auth.googleOAuthClientId;

  if (!clientId) {
    if (!config.auth.allowMockAuth) {
      throw new Error(
        "Set GOOGLE_OAUTH_CLIENT_ID or enable ALLOW_MOCK_AUTH for local MCP.",
      );
    }
    const email = process.env["MCP_OPERATOR_EMAIL"] ?? "local@tomcat.eu";
    return {
      kind: "human",
      email,
      domain: email.split("@")[1] ?? "tomcat.eu",
      role: "internal_team",
      team: undefined,
      investorId: undefined,
    };
  }

  const idToken =
    process.env["GOOGLE_ID_TOKEN"]?.trim() ?? (await resolveStoredGoogleIdToken());

  let resolveRole = placeholderRoleResolver;
  if (config.database.url) {
    const db = createDb(config.database.url);
    const store = await createPgCoreStore(db);
    resolveRole = createDbRoleResolver(store);
  }

  return verifyGoogleIdToken(
    {
      clientId,
      allowedDomains: config.auth.allowedGoogleDomains,
      resolveRole,
    },
    idToken,
  );
};
