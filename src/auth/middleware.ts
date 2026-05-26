import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthInvalid, AuthRequired, Forbidden } from "../errors/index.js";
import { hasBearerToken } from "./bearer.js";
import { staleBearerAuthInvalid } from "./authHints.js";
import type { Identity } from "../domain/identity.js";
import { can, type Action } from "../permissions/policies.js";
import type { Auditor } from "../audit/audit.js";
import type { IdentityResolver } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    identity?: Identity;
  }
}

export type AuthDeps = {
  resolvers: IdentityResolver[];
  auditor: Auditor;
};

export const createAuthMiddleware = ({ resolvers, auditor }: AuthDeps) => {
  const authenticate = async (
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    for (const resolver of resolvers) {
      const id = await resolver.resolve(req);
      if (id) {
        req.identity = id;
        return;
      }
    }
    if (hasBearerToken(req)) {
      throw staleBearerAuthInvalid();
    }
    throw AuthRequired();
  };

  const requirePermission = (action: Action) => {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(req, reply);
      const id = req.identity;
      if (!id) throw AuthRequired();
      if (!can(id, action)) {
        auditor.record(id, {
          action,
          resource: req.url,
          outcome: "denied",
          reason: "permission_check_failed",
          meta: undefined,
        });
        throw Forbidden(`Missing permission: ${action}`);
      }
      auditor.record(id, {
        action,
        resource: req.url,
        outcome: "allowed",
        reason: undefined,
        meta: undefined,
      });
    };
  };

  return { authenticate, requirePermission };
};
