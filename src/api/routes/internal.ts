import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired, BadRequest } from "../../errors/index.js";
import type { BriefsService } from "../../services/briefs.js";
import type { AuthMiddleware } from "../middlewareTypes.js";

const BoardPrepBody = z.object({ portfolioCompanyId: z.string().min(1) });

export const registerInternalRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  briefs: BriefsService,
): void => {
  app.post(
    "/internal/briefs/board-prep",
    { preHandler: auth.requirePermission("briefs.write") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = BoardPrepBody.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid body", { issues: parsed.error.issues });
      }
      return briefs.boardPrep(req.identity, parsed.data.portfolioCompanyId);
    },
  );
};
