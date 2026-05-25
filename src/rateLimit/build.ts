import type { AppConfig } from "../config/env.js";
import type { Db } from "../storage/pgClient.js";
import { createMemoryRateLimitStore } from "./memoryStore.js";
import { createPostgresRateLimitStore } from "./postgresStore.js";
import { createRateLimitService } from "./service.js";
import type { RateLimitService } from "./types.js";

export const buildRateLimitService = (
  config: AppConfig,
  db: Db | undefined,
): RateLimitService => {
  const usePostgres =
    config.rateLimit.store === "postgres"
    && db !== undefined
    && config.database.url !== undefined;

  const store = usePostgres
    ? createPostgresRateLimitStore(db)
    : createMemoryRateLimitStore();

  return createRateLimitService(store, config);
};
