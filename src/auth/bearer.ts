import type { FastifyRequest } from "fastify";

export const extractBearer = (req: FastifyRequest): string | undefined => {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const [scheme, value] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value;
};

export const hasBearerToken = (req: FastifyRequest): boolean =>
  extractBearer(req) !== undefined;
