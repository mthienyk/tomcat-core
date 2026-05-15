import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired } from "../../errors/index.js";
import type { StartupsService } from "../../services/startups.js";
import type { AuthMiddleware } from "../middlewareTypes.js";

const BrowseQuery = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  sector: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const registerConnectorRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  startups: StartupsService,
): void => {
  app.get(
    "/connectors/hubspot/startups",
    { preHandler: auth.requirePermission("society.read") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const { q, sector, limit } = BrowseQuery.parse(req.query);
      const results = await startups.searchStartups(
        req.identity,
        {
          ...(q !== undefined ? { startupName: q } : {}),
          ...(sector !== undefined ? { sector } : {}),
        },
        { limit },
      );
      return { count: results.length, startups: results };
    },
  );
};
