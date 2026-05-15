import type { FastifyInstance } from "fastify";
import type { Connectors } from "../../connectors/registry.js";

type ConnectorProbe = {
  name: "hubspot" | "monday" | "drive";
  status: "ok" | "not_configured" | "error";
  latencyMs: number;
  detail?: string;
};

const probe = async (
  name: ConnectorProbe["name"],
  fn: () => Promise<unknown>,
): Promise<ConnectorProbe> => {
  const startedAt = Date.now();
  try {
    await fn();
    return { name, status: "ok", latencyMs: Date.now() - startedAt };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const status = detail.includes("not configured") ? "not_configured" : "error";
    return { name, status, latencyMs: Date.now() - startedAt, detail };
  }
};

export const registerHealthRoutes = (
  app: FastifyInstance,
  connectors?: Connectors,
): void => {
  app.get("/health", async () => ({
    status: "ok",
    service: "tomcat-core",
    version: process.env["npm_package_version"] ?? "0.0.0",
    ts: new Date().toISOString(),
  }));

  if (!connectors) return;

  app.get("/health/connectors", async () => {
    const probes = await Promise.all([
      probe("hubspot", () => connectors.hubspot.listStartups()),
      probe("monday", () => connectors.monday.listPortfolio()),
      probe("drive", () => connectors.drive.listBoardPacksForCompany("Tomcat")),
    ]);
    const overall = probes.every((p) => p.status === "ok") ? "ok" : "degraded";
    return {
      status: overall,
      ts: new Date().toISOString(),
      connectors: probes,
    };
  });
};
