import type { FastifyRequest } from "fastify";
import { AuthInvalid, CoreError } from "../../errors/index.js";
import type { HumanIdentity, Role } from "../../domain/identity.js";
import type { IdentityResolver } from "../types.js";
import type { RoleResolver } from "../roleResolver.js";
import { accessRevokedMessage } from "../authHints.js";
import { emailDomain, normalizeEmail } from "../email.js";
import type { McpOAuthService } from "../mcpOauth/service.js";
import type { CoreStore } from "../../storage/coreStore.js";

export type SocietyOAuthIdentityResolverOptions = {
  service: McpOAuthService;
  store: CoreStore;
  resolveRole: RoleResolver;
  allowedGoogleDomains: string[];
};

const SOCIETY_SCOPE = "society.read";

const extractBearer = (req: FastifyRequest): string | undefined => {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const [scheme, value] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value;
};

const looksLikeOpaqueToken = (token: string): boolean =>
  !token.includes(".") && !token.includes(" ");

const tokenHasScope = (scopes: string, required: string): boolean =>
  scopes.split(/\s+/).filter(Boolean).includes(required);

const isAllowedGoogleDomain = (
  email: string,
  allowedDomains: string[],
): boolean => {
  const domain = emailDomain(email);
  return allowedDomains.includes(domain);
};

export const createSocietyOauthIdentityResolver = (
  opts: SocietyOAuthIdentityResolverOptions,
): IdentityResolver => ({
  name: "society-oauth-bearer",
  resolve: async (req): Promise<HumanIdentity | undefined> => {
    const token = extractBearer(req);
    if (!token || !looksLikeOpaqueToken(token)) return undefined;

    const resolved = await opts.service.resolveAccessToken(token);
    if (!resolved || !tokenHasScope(resolved.scopes, SOCIETY_SCOPE)) {
      return undefined;
    }

    const email = normalizeEmail(resolved.principalEmail);

    if (isAllowedGoogleDomain(email, opts.allowedGoogleDomains)) {
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
    }

    const member = await opts.store.getSocietyMemberByEmail(email);
    if (!member) {
      throw AuthInvalid(accessRevokedMessage(email), {
        reason: "access_revoked",
      });
    }

    return {
      kind: "human",
      email,
      domain: emailDomain(email),
      role: "external_investor",
      team: undefined,
      investorId: member.investorId,
    };
  },
});
