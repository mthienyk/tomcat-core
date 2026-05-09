import type { FastifyInstance } from "fastify";

export const registerHealthRoutes = (app: FastifyInstance): void => {
  app.get("/health", async () => ({
    status: "ok",
    service: "tomcat-core",
    version: process.env["npm_package_version"] ?? "0.0.0",
    ts: new Date().toISOString(),
  }));
};
