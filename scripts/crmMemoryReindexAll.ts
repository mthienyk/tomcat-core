import "dotenv/config";
import pino from "pino";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { CRM_MEMORY_SCHEMA_VERSION } from "../src/domain/crmMemory.js";
import { buildEmbeddingRegistry } from "../src/llm/embeddings/registry.js";
import { buildLlmRegistry } from "../src/llm/registry.js";
import { buildPinoOptions } from "../src/logger/index.js";
import { MIN_SEMANTIC_INDEX_BODY_LENGTH } from "../src/services/crmMemory/indexEligibility.js";
import { resolveCrmMemorySemanticLlm } from "../src/services/crmMemory/semanticLlm.js";
import { createDb } from "../src/storage/pgClient.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import {
  ensureHubspotStartupForCompany,
  listStartupIdsMissingFromNotes,
} from "../src/sync/ensureHubspotStartup.js";
import { createCrmMemoryIndexWorker } from "../src/sync/crmMemoryIndexWorker.js";

const parseFlag = (name: string): boolean => process.argv.includes(name);

const parseIntArg = (name: string, fallback: number): number => {
  const match = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!match) return fallback;
  const value = Number.parseInt(match.split("=")[1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const dryRun = parseFlag("--dry-run");
const resetOnly = parseFlag("--reset-only");
const noReset = parseFlag("--no-reset");
const skipOrphans = parseFlag("--skip-orphans");
const batchSize = parseIntArg("--batch-size", 20);
const concurrency = parseIntArg("--concurrency", 20);
const maxRounds = parseIntArg("--max-rounds", 500);

const ensureOrphanStartups = async (
  config: ReturnType<typeof loadConfig>,
  store: Awaited<ReturnType<typeof createPgCoreStore>>,
): Promise<{ orphanIds: number; created: number; missing: number }> => {
  const connectors = buildConnectors(config);
  const orphanIds = await listStartupIdsMissingFromNotes(store);
  let created = 0;
  let missing = 0;

  for (const companyId of orphanIds) {
    const result = await ensureHubspotStartupForCompany({
      store,
      connectors,
      companyId,
    });
    if (result === "created") created += 1;
    if (result === "missing") missing += 1;
  }

  return { orphanIds: orphanIds.length, created, missing };
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!config.database.url) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(config.database.url);
  const store = await createPgCoreStore(db);
  const logger = pino(buildPinoOptions("info", { script: "crmMemoryReindexAll" }));

  const [before] = await db<
    {
      chunks: number;
      notes_indexable: number;
      notes_indexed: number;
      notes_pending: number;
    }[]
  >`
    select
      (select count(*)::int from knowledge_index_chunks where source_kind = 'hubspot_note') as chunks,
      (select count(*)::int from notes
        where startup_id is not null
          and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}) as notes_indexable,
      (select count(*)::int from notes
        where startup_id is not null
          and semantic_index_hash is not null
          and semantic_index_hash not like 'skip:%') as notes_indexed,
      (select count(*)::int from notes
        where startup_id is not null
          and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
          and (semantic_index_hash is null or semantic_index_hash = '')) as notes_pending
  `;

  console.log(
    JSON.stringify(
      {
        phase: "before",
        schemaVersion: CRM_MEMORY_SCHEMA_VERSION,
        dryRun,
        resetOnly,
        noReset,
        skipOrphans,
        batchSize,
        concurrency,
        maxRounds,
        ...before,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          hint:
            "Re-run without --dry-run to reset (unless --no-reset) and re-embed indexable notes.",
        },
        null,
        2,
      ),
    );
    await db.end({ timeout: 5 });
    return;
  }

  if (!skipOrphans) {
    const orphanResult = await ensureOrphanStartups(config, store);
    console.log(JSON.stringify({ phase: "ensure_orphans", ...orphanResult }, null, 2));
  }

  if (!noReset) {
    const deleted = await db<{ count: number }[]>`
      with deleted as (
        delete from knowledge_index_chunks
        where source_kind = 'hubspot_note'
        returning 1
      )
      select count(*)::int as count from deleted
    `;

    const reset = await db<{ count: number }[]>`
      with updated as (
        update notes
        set semantic_index_hash = null
        where startup_id is not null
          and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
          and (semantic_index_hash is null or semantic_index_hash not like 'skip:%')
        returning 1
      )
      select count(*)::int as count from updated
    `;

    console.log(
      JSON.stringify(
        {
          phase: "reset",
          deletedChunks: deleted[0]?.count ?? 0,
          notesQueuedForReindex: reset[0]?.count ?? 0,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          phase: "reset",
          skipped: true,
          hint: "Continuing pending queue without wiping existing chunks.",
        },
        null,
        2,
      ),
    );
  }

  if (resetOnly) {
    console.log(
      JSON.stringify(
        {
          hint:
            "Reset complete. Run without --reset-only to process, or let the prod worker drain the queue.",
        },
        null,
        2,
      ),
    );
    await db.end({ timeout: 5 });
    return;
  }

  const llmRegistry = buildLlmRegistry(config);
  if (!llmRegistry.hasAnyProvider()) {
    throw new Error("No LLM provider configured (OPENAI_API_KEY or equivalent required)");
  }

  const semanticLlm = resolveCrmMemorySemanticLlm(config, llmRegistry);
  const embeddingRegistry = buildEmbeddingRegistry(config);
  if (!embeddingRegistry.defaultProvider()) {
    throw new Error("Embedding provider is not configured");
  }

  const connectors = buildConnectors(config);
  const worker = createCrmMemoryIndexWorker({
    store,
    connectors,
    embeddingRegistry,
    logger,
    config: {
      enabled: true,
      batchSize,
      concurrency,
      semanticLlm,
    },
  });

  let totalIndexed = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const indexed = await worker.runOnce();
    totalIndexed += indexed;
    console.log(JSON.stringify({ phase: "index", round, indexed, totalIndexed }));

    if (indexed === 0) break;
  }

  const [after] = await db<
    {
      chunks: number;
      notes_indexed: number;
      notes_pending: number;
    }[]
  >`
    select
      (select count(*)::int from knowledge_index_chunks where source_kind = 'hubspot_note') as chunks,
      (select count(*)::int from notes
        where startup_id is not null
          and semantic_index_hash is not null
          and semantic_index_hash not like 'skip:%') as notes_indexed,
      (select count(*)::int from notes
        where startup_id is not null
          and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
          and (semantic_index_hash is null or semantic_index_hash = '')) as notes_pending
  `;

  console.log(
    JSON.stringify(
      {
        phase: "after",
        schemaVersion: CRM_MEMORY_SCHEMA_VERSION,
        semanticModel: semanticLlm.model,
        totalIndexedThisRun: totalIndexed,
        ...after,
        hint:
          after?.notes_pending && after.notes_pending > 0
            ? "Some notes remain pending — re-run with --no-reset or wait for the prod worker."
            : "Reindex complete. Run npm run crm:query-benchmark to spot-check retrieval.",
      },
      null,
      2,
    ),
  );

  await db.end({ timeout: 5 });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
