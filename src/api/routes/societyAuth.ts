import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BadRequest } from "../../errors/index.js";
import type { SocietyAuthService } from "../../auth/societyAuth/service.js";
import { clientIp } from "../clientIp.js";
import type { RateLimitService } from "../../rateLimit/types.js";
import { normalizeEmail } from "../../auth/email.js";

export type SocietyAuthRoutesDeps = {
  service: SocietyAuthService;
  magicLinkVerifyBaseUrl: string;
  rateLimit: RateLimitService;
};

const MagicLinkBody = z.object({
  email: z.string().email(),
});

const MagicLinkCompleteBody = z.object({
  token: z.string().min(1),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal("S256"),
});

export const registerSocietyAuthRoutes = (
  app: FastifyInstance,
  deps: SocietyAuthRoutesDeps,
): void => {
  app.post("/society/auth/magic-link", async (req, reply) => {
    const parsed = MagicLinkBody.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid body", { issues: parsed.error.issues });
    }

    const ip = clientIp(req);
    const ipRate = await deps.rateLimit.consume(
      "society.auth.magic_link",
      `ip:${ip}`,
    );
    if (!ipRate.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(ipRate.retryAfter))
        .send({ error: "rate_limited" });
    }

    const email = normalizeEmail(parsed.data.email);
    const emailRate = await deps.rateLimit.consume(
      "society.auth.magic_link",
      `email:${email}`,
    );
    if (!emailRate.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(emailRate.retryAfter))
        .send({ error: "rate_limited" });
    }

    const result = await deps.service.requestMagicLink(
      email,
      deps.magicLinkVerifyBaseUrl,
    );
    return result;
  });

  app.post("/society/auth/magic-link/complete", async (req, reply) => {
    const parsed = MagicLinkCompleteBody.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid body", { issues: parsed.error.issues });
    }

    const result = await deps.service.completeMagicLink(parsed.data);
    if (!result) {
      return reply.status(400).send({ error: "invalid_or_expired_token" });
    }
    return result;
  });
};
