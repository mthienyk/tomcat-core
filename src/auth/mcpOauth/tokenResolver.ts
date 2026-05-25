import type { FastifyRequest } from "fastify";
import { AuthInvalid, CoreError } from "../../errors/index.js";
import type { HumanIdentity, Role } from "../../domain/identity.js";
import type { IdentityResolver } from "../types.js";
import type { RoleResolver } from "../roleResolver.js";
import { accessRevokedMessage } from "../authHints.js";
import { normalizeEmail, emailDomain } from "../email.js";
import type { McpOAuthService } from "./service.js";

export type McpOAuthIdentityResolverOptions = {
  service: McpOAuthService;
  resolveRole: RoleResolver;
};

const extractBearer = (req: FastifyRequest): string | undefined => {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const [scheme, value] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value;
};

const looksLikeOpaqueToken = (token: string): boolean =>
  !token.includes(".") && !token.includes(" ");

export const createMcpOauthIdentityResolver = (
  opts: McpOAuthIdentityResolverOptions,
): IdentityResolver => ({
  name: "mcp-oauth-bearer",
  resolve: async (req): Promise<HumanIdentity | undefined> => {
    const token = extractBearer(req);
    if (!token || !looksLikeOpaqueToken(token)) return undefined;

    const resolved = await opts.service.resolveAccessToken(token);
    if (!resolved) return undefined;

    const scopes = resolved.scopes.split(/\s+/).filter(Boolean);
    if (!scopes.includes("mcp:tools")) return undefined;

    const email = normalizeEmail(resolved.principalEmail);
    let role: Role;
    let team: string | undefined;
    try {
      const result = await opts.resolveRole(email);
      role = result.role as Role;
      team = result.team;
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw AuthInvalid(accessRevokedMessage(email), {
        reason: "access_revoked",
      });
    }

    return {
      kind: "human",
      email,
      domain: emailDomain(email),
      role,
      team,
      investorId: undefined,
    };
  },
});
