import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./pgClient.js";
import { withMigrationLock } from "./pgAdvisoryLock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATION_FILES = [
  "pg_000_extensions.sql",
  "pg_001_signal_hub.sql",
  "pg_002_core.sql",
  "pg_003_identity.sql",
  "pg_004_mcp_oauth.sql",
] as const;

export const runPgMigrations = async (db: Db): Promise<void> => {
  await withMigrationLock(db, async () => {
    for (const file of MIGRATION_FILES) {
      const sql = readFileSync(join(__dirname, "migrations", file), "utf-8");
      await db.unsafe(sql);
    }
  });
};
