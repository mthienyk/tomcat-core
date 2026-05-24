import { loadConfig } from "../config/env.js";
import type { AppConfig } from "../config/env.js";
import { createDbRoleResolver } from "./dbRoleResolver.js";
import { placeholderRoleResolver } from "./roleResolver.js";
import type { HumanIdentity } from "../domain/identity.js";
import { resolveStoredGoogleIdToken } from "./googleOAuthSession.js";
import { verifyGoogleIdToken } from "./verifyGoogleIdToken.js";
import type { CoreStore } from "../storage/coreStore.js";

export const createMcpCallerResolver = (
  config: AppConfig,
  store?: CoreStore,
): (() => Promise<HumanIdentity>) => {
  const clientId = config.auth.googleOAuthClientId;
  const resolveRole = store
    ? createDbRoleResolver(store, {
        autoProvisionDomains: config.auth.allowedGoogleDomains,
      })
    : placeholderRoleResolver;

  return async (): Promise<HumanIdentity> => {
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

    return verifyGoogleIdToken(
      {
        clientId,
        allowedDomains: config.auth.allowedGoogleDomains,
        resolveRole,
      },
      idToken,
    );
  };
};

export const resolveMcpCaller = createMcpCallerResolver(loadConfig());
