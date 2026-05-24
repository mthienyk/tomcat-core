import type { FastifyRequest } from "fastify";
import { AuthInvalid, CoreError } from "../errors/index.js";
import type { HumanIdentity } from "../domain/identity.js";
import type { IdentityResolver } from "./types.js";
import type { RoleResolver } from "./roleResolver.js";
import { verifyGoogleIdToken } from "./verifyGoogleIdToken.js";

export type GoogleResolverOptions = {
  clientId: string;
  allowedDomains: string[];
  resolveRole: RoleResolver;
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
): IdentityResolver => ({
  name: "google-human",
  resolve: async (req): Promise<HumanIdentity | undefined> => {
    const token = extractBearer(req);
    if (!token) return undefined;

    try {
      return await verifyGoogleIdToken(opts, token);
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw AuthInvalid("Invalid Google ID token");
    }
  },
});
