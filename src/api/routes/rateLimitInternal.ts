import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BadRequest } from "../../errors/index.js";
import type { RateLimitService } from "../../rateLimit/types.js";

const ConsumeBody = z.object({
  rule: z.enum([
    "society.auth.magic_link",
    "oauth.register",
    "society.bff.oauth_google",
    "society.bff.startups",
  ]),
  key: z.string().min(1).max(256),
});

const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export type RateLimitInternalRoutesDeps = {
  service: RateLimitService;
  serviceKey: string | undefined;
};

export const registerRateLimitInternalRoutes = (
  app: FastifyInstance,
  deps: RateLimitInternalRoutesDeps,
): void => {
  app.post("/internal/rate-limit/consume", async (req, reply) => {
    if (!deps.serviceKey) {
      return reply.status(503).send({ error: "rate_limit_service_disabled" });
    }

    const header = req.headers["x-rate-limit-service-key"];
    const provided = typeof header === "string" ? header : "";
    if (!safeEqual(provided, deps.serviceKey)) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const parsed = ConsumeBody.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid body", { issues: parsed.error.issues });
    }

    const result = await deps.service.consume(parsed.data.rule, parsed.data.key);
    return reply.send(result);
  });
};
