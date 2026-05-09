import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired, BadRequest } from "../../errors/index.js";
import type { SocietyService } from "../../services/society.js";
import type { AuthMiddleware } from "../middlewareTypes.js";

const InvestorParams = z.object({ id: z.string().min(1) });
const PortfolioParams = z.object({ id: z.string().min(1) });
const SignalsQuery = z.object({
  sinceDays: z.coerce.number().int().positive().max(365).default(30),
});

export const registerSocietyRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  society: SocietyService,
): void => {
  app.get(
    "/society/investors/:id/home",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { id } = InvestorParams.parse(req.params);
      return society.getInvestorHome(req.identity, id);
    },
  );

  app.get(
    "/society/portfolio/:id/signals",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { id } = PortfolioParams.parse(req.params);
      const q = SignalsQuery.safeParse(req.query);
      if (!q.success) throw BadRequest("Invalid query", { issues: q.error.issues });
      return society.getPortfolioSignals(req.identity, id, q.data.sinceDays);
    },
  );
};
