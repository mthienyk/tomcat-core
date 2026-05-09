import type { FastifyInstance } from "fastify";
import type { AuthMiddleware } from "../middlewareTypes.js";

export const registerMeRoutes = (
  app: FastifyInstance,
  auth: AuthMiddleware,
): void => {
  app.get("/me", { preHandler: auth.authenticate }, async (req) => ({
    identity: req.identity,
  }));
};
