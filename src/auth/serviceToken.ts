import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { AuthInvalid } from "../errors/index.js";
import type {
  HumanIdentity,
  Role,
  ServiceIdentity,
} from "../domain/identity.js";
import type { IdentityResolver } from "./types.js";

export type ServiceClient = { clientId: string; scopes: string[] };

const ActAsRoleSchema = z.enum([
  "admin",
  "internal_team",
  "finance",
  "investor_relations",
  "portfolio_ops",
  "external_investor",
  "service_client",
]);

const ClaimsSchema = z.object({
  sub: z.string().min(1),
  scope: z.string().min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  nbf: z.number().int().positive().optional(),
  act_as: z
    .object({
      email: z.string().email(),
      role: ActAsRoleSchema,
      team: z.string().min(1).optional(),
      investorId: z.string().min(1).optional(),
    })
    .optional(),
});

export type ServiceTokenActAs = {
  email: string;
  role: Role;
  team?: string;
  investorId?: string;
};

export type ServiceTokenClaims = {
  sub: string;
  scopes: string[];
  exp: number;
  nbf?: number;
  actAs?: ServiceTokenActAs;
};

export type ServiceTokenSigningOptions = {
  secret: string;
  issuer: string;
  audience: string;
};

type VerifiedServiceTokenClaims = ServiceTokenClaims & { iat: number };

const toKey = (secret: string): Uint8Array => Buffer.from(secret, "utf8");

export const signServiceToken = async (
  opts: ServiceTokenSigningOptions,
  claims: ServiceTokenClaims,
): Promise<string> => {
  const payload: Record<string, unknown> = {
    scope: claims.scopes.join(" "),
  };
  if (claims.actAs !== undefined) {
    payload["act_as"] = claims.actAs;
  }

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(claims.exp);

  if (claims.nbf !== undefined) {
    jwt.setNotBefore(claims.nbf);
  }

  return jwt.sign(toKey(opts.secret));
};

const verifyServiceToken = async (
  opts: ServiceResolverOptions,
  token: string,
  maxTokenLifetimeSeconds: number,
): Promise<VerifiedServiceTokenClaims> => {
  if (token.split(".").length !== 3) throw AuthInvalid("Malformed JWT");

  let payload: unknown;
  try {
    const verified = await jwtVerify(token, toKey(opts.secret), {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ["HS256"],
    });
    payload = verified.payload;
  } catch {
    throw AuthInvalid("Invalid service token JWT");
  }

  const result = ClaimsSchema.safeParse(payload);
  if (!result.success) {
    throw AuthInvalid("Invalid service token claims");
  }
  const claims = result.data;
  const scopes = claims.scope.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) throw AuthInvalid("Invalid service token scopes");

  if (claims.exp - claims.iat > maxTokenLifetimeSeconds) {
    throw AuthInvalid("Service token lifetime exceeds maximum allowed window");
  }
  if (
    claims.act_as?.role === "external_investor" &&
    claims.act_as.investorId === undefined
  ) {
    throw AuthInvalid(
      "act_as.investorId is required for external_investor delegation",
    );
  }

  const verifiedClaims: VerifiedServiceTokenClaims = {
    sub: claims.sub,
    scopes,
    exp: claims.exp,
    iat: claims.iat,
  };
  if (claims.nbf !== undefined) {
    verifiedClaims.nbf = claims.nbf;
  }
  if (claims.act_as !== undefined) {
    const actAs: ServiceTokenActAs = {
      email: claims.act_as.email,
      role: claims.act_as.role as Role,
    };
    if (claims.act_as.team !== undefined) {
      actAs.team = claims.act_as.team;
    }
    if (claims.act_as.investorId !== undefined) {
      actAs.investorId = claims.act_as.investorId;
    }
    verifiedClaims.actAs = actAs;
  }
  return verifiedClaims;
};

export type ServiceResolverOptions = {
  secret: string;
  issuer: string;
  audience: string;
  registeredClients: ServiceClient[];
  maxTokenLifetimeSeconds?: number;
};

const HEADER = "x-service-token";

export const createServiceTokenResolver = (
  opts: ServiceResolverOptions,
): IdentityResolver => {
  const maxTokenLifetimeSeconds = opts.maxTokenLifetimeSeconds ?? 3600;
  const registry = new Map(opts.registeredClients.map((c) => [c.clientId, c.scopes]));

  return {
    name: "service-token",
    resolve: async (req: FastifyRequest): Promise<ServiceIdentity | undefined> => {
      const raw = req.headers[HEADER];
      if (typeof raw !== "string" || !raw) return undefined;

      const claims = await verifyServiceToken(opts, raw, maxTokenLifetimeSeconds);
      const allowed = registry.get(claims.sub);
      if (!allowed) throw AuthInvalid(`Unknown service client "${claims.sub}"`);

      const grantedScopes = claims.scopes.filter((s) => allowed.includes(s));
      if (grantedScopes.length === 0) throw AuthInvalid("No granted scopes");

      let onBehalfOf: HumanIdentity | undefined;
      if (claims.actAs) {
        const { email, role, team, investorId } = claims.actAs;
        onBehalfOf = {
          kind: "human",
          email,
          domain: email.split("@")[1] ?? "",
          role: role as Role,
          team,
          investorId,
        };
      }

      return {
        kind: "service",
        clientId: claims.sub,
        scopes: grantedScopes,
        onBehalfOf,
      };
    },
  };
};
