import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig } from "../../config/env.js";
import { createSerperConnector, createUnconfiguredSerperConnector } from "../../connectors/serper.js";
import {
  createUnipileConnector,
  createUnconfiguredUnipileConnector,
} from "../../connectors/unipile.js";
import { createSqliteSignalStore } from "../../storage/sqliteSignalStore.js";
import { createPgSignalStore } from "../../storage/pgSignalStore.js";
import type { Sql } from "postgres";
import type { StartupsService } from "../startups.js";
import type { SignalStore } from "../../storage/signalStore.js";
import type { GuardianRegistry } from "./accountGuardian.js";
import { createGuardianRegistry } from "./accountGuardian.js";
import { createEntityResolver } from "./resolver.js";
import { createSignalQueue } from "./queue.js";
import { buildSignalHubService, type SignalHubService } from "./index.js";

export type SignalHubStack = {
  signalHub: SignalHubService;
  store: SignalStore;
  guardians: GuardianRegistry;
  start: () => void;
  stop: () => void;
};

export type BootstrapSignalHubOptions = {
  config: AppConfig;
  startups: StartupsService;
  pgDb?: Sql;
  onInfo?: (message: string) => void;
};

export const bootstrapSignalHub = async (
  options: BootstrapSignalHubOptions,
): Promise<SignalHubStack> => {
  const { config, startups, pgDb, onInfo } = options;
  const shConfig = config.signalHub;

  const store =
    shConfig.storeDriver === "postgres" && pgDb
      ? await createPgSignalStore(pgDb)
      : (() => {
          const dir = dirname(shConfig.storePath);
          if (dir !== ".") {
            mkdirSync(dir, { recursive: true });
          }
          return createSqliteSignalStore(shConfig.storePath);
        })();

  if (shConfig.storeDriver === "postgres" && pgDb) {
    onInfo?.("SignalStore using Postgres");
  }

  const guardianRegistry = createGuardianRegistry(store);

  void store.listUnipileAccounts().then((accounts) => {
    for (const account of accounts) {
      if (account.state !== "killed") {
        guardianRegistry.getOrCreate(
          account.accountId,
          account.label,
          account.dailyQuota,
        );
      }
    }
  });

  const serper = shConfig.serperApiKey
    ? createSerperConnector(shConfig.serperApiKey)
    : createUnconfiguredSerperConnector();

  const unipile =
    shConfig.unipileDsn && shConfig.unipileApiKey
      ? createUnipileConnector(shConfig.unipileDsn, shConfig.unipileApiKey)
      : createUnconfiguredUnipileConnector();

  const queue = createSignalQueue({
    store,
    serper,
    unipile,
    guardians: guardianRegistry,
  });

  const resolver = createEntityResolver(store, startups);
  const signalHub = buildSignalHubService({
    store,
    queue,
    resolver,
    guardians: guardianRegistry,
  });

  return {
    signalHub,
    store,
    guardians: guardianRegistry,
    start: () => queue.start(),
    stop: () => queue.stop(),
  };
};
