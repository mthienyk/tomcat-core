import type { CoreStore } from "../storage/coreStore.js";
import type { Connectors } from "../connectors/registry.js";
import type { Logger } from "../logger/index.js";

export type SyncWorkerDeps = {
  store: CoreStore;
  connectors: Connectors;
  logger: Logger;
};

export type SyncWorker = {
  readonly dataset: string;
  run(deps: SyncWorkerDeps): Promise<void>;
};
