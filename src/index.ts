import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { buildServer } from "./server.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const app = await buildServer(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutdown_initiated");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown_error");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: "0.0.0.0" });
};

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
