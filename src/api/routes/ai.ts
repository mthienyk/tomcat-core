import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthRequired, BadRequest } from "../../errors/index.js";
import type { AiService } from "../../services/ai.js";
import type { AuthMiddleware } from "../middlewareTypes.js";

const QuerySchema = z.object({
  text: z.string().min(3).max(2000),
  provider: z.enum(["anthropic", "openai", "google"]).optional(),
  model: z.string().min(1).max(120).optional(),
});

export const registerAiRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
  ai: AiService,
): void => {
  app.post(
    "/ai/query",
    { preHandler: auth.requirePermission("ai.query") },
    async (req) => {
      if (!req.identity) throw AuthRequired();
      const parsed = QuerySchema.safeParse(req.body);
      if (!parsed.success) {
        throw BadRequest("Invalid query body", { issues: parsed.error.issues });
      }
      return ai.query(req.identity, {
        text: parsed.data.text,
        provider: parsed.data.provider,
        model: parsed.data.model,
      });
    },
  );
};
