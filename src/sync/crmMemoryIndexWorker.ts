import type { CoreStore } from "../storage/coreStore.js";
import type { Connectors } from "../connectors/registry.js";
import type { Logger } from "../logger/index.js";
import type { EmbeddingRegistry } from "../llm/embeddings/types.js";
import type { CrmMemorySemanticLlm } from "../services/crmMemory/semanticLlm.js";
import { buildSemanticCardGenerator } from "../services/crmMemory/semanticCard.js";
import { buildNoteIndexer } from "../services/crmMemory/indexNote.js";
import { ensureHubspotStartupForCompany } from "./ensureHubspotStartup.js";

export type CrmMemoryIndexWorkerConfig = {
  enabled: boolean;
  batchSize: number;
  concurrency: number;
  semanticLlm: CrmMemorySemanticLlm;
};

export type CrmMemoryIndexWorker = {
  runOnce(): Promise<number>;
};

export const createCrmMemoryIndexWorker = (deps: {
  store: CoreStore;
  connectors: Connectors;
  embeddingRegistry: EmbeddingRegistry;
  logger: Logger;
  config: CrmMemoryIndexWorkerConfig;
}): CrmMemoryIndexWorker => {
  const { store, connectors, embeddingRegistry, logger, config } = deps;

  return {
    runOnce: async (): Promise<number> => {
      if (!config.enabled) return 0;

      const embeddingProvider = embeddingRegistry.defaultProvider();
      if (!embeddingProvider) {
        logger.debug("crm_memory_index_skipped_no_embeddings");
        return 0;
      }

      const semanticCards = buildSemanticCardGenerator({
        llm: config.semanticLlm,
      });
      const indexer = buildNoteIndexer({
        store,
        semanticCards,
        embeddingProvider,
        semanticModel: config.semanticLlm.model,
        concurrency: config.concurrency,
        logger,
        resolveStartupForNote: async (startupId) => {
          await ensureHubspotStartupForCompany({
            store,
            connectors,
            companyId: startupId,
          });
        },
      });

      const indexed = await indexer.indexPendingBatch(config.batchSize);
      if (indexed > 0) {
        logger.info({ indexed }, "crm_memory_index_batch_complete");
      }
      return indexed;
    },
  };
};

export const drainCrmMemoryIndex = async (
  worker: CrmMemoryIndexWorker,
  logger?: Logger,
  maxRounds = 3,
): Promise<number> => {
  let total = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const indexed = await worker.runOnce();
    total += indexed;
    if (indexed === 0) break;
  }

  if (total > 0) {
    logger?.info({ indexed: total }, "crm_memory_index_drain_complete");
  }

  return total;
};
