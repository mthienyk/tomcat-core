import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { FastifyRequest } from "fastify";
import { AuthInvalid } from "../errors/index.js";
import type { HumanIdentity, Role } from "../domain/identity.js";
import type { IdentityResolver } from "./types.js";

export type GoogleResolverOptions = {
  clientId: string;
  allowedDomains: string[];
  resolveRole: (email: string) => { role: Role; team: string | undefined } | Promise<{ role: Role; team: string | undefined }>;
};

const extractBearer = (req: FastifyRequest): string | undefined => {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const [scheme, value] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value;
};

export const createGoogleHumanResolver = (
  opts: GoogleResolverOptions,
): IdentityResolver => {
  const client = new OAuth2Client(opts.clientId);

  const verify = async (idToken: string): Promise<TokenPayload> => {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: opts.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) {
      throw AuthInvalid("Google ID token missing verified email");
    }
    return payload;
  };

  return {
    name: "google-human",
    resolve: async (req): Promise<HumanIdentity | undefined> => {
      const token = extractBearer(req);
      if (!token) return undefined;

      let payload: TokenPayload;
      try {
        payload = await verify(token);
      } catch {
        throw AuthInvalid("Invalid Google ID token");
      }

      const email = payload.email as string;
      const domain = email.split("@")[1] ?? "";
      if (!opts.allowedDomains.includes(domain)) {
        throw AuthInvalid(`Domain "${domain}" is not allowed`);
      }

      const { role, team } = await opts.resolveRole(email);
      return {
        kind: "human",
        email,
        domain,
        role,
        team,
        investorId: undefined,
        investorTier: undefined,
      };
    },
  };
};
