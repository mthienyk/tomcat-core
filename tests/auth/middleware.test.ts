import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { createAuthMiddleware } from "../../src/auth/middleware.js";
import { createAuditor } from "../../src/audit/audit.js";
import type { IdentityResolver } from "../../src/auth/types.js";

const auditor = createAuditor({
  child: () => ({
    info: () => undefined,
  }),
} as never);

const reqWithBearer = (token: string): FastifyRequest =>
  ({
    headers: { authorization: `Bearer ${token}` },
  }) as FastifyRequest;

const noopResolver = (): IdentityResolver => ({
  name: "noop",
  resolve: async () => undefined,
});

describe("createAuthMiddleware", () => {
  it("returns AUTH_REQUIRED when no bearer is present", async () => {
    const { authenticate } = createAuthMiddleware({
      resolvers: [noopResolver()],
      auditor,
    });

    await expect(
      authenticate({ headers: {} } as FastifyRequest, {} as never),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("returns AUTH_INVALID with reconnect hint for stale bearer", async () => {
    const { authenticate } = createAuthMiddleware({
      resolvers: [noopResolver()],
      auditor,
    });

    await expect(
      authenticate(reqWithBearer("expired_opaque_access_token"), {} as never),
    ).rejects.toMatchObject({
      code: "AUTH_INVALID",
      details: {
        reason: "invalid_token",
        nextAction: "reconnect_mcp_connector",
      },
    });
  });
});
