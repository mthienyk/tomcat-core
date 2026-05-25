import "dotenv/config";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { buildStoreBackedConnectors } from "../src/connectors/storeBacked.js";
import { createDb } from "../src/storage/pgClient.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import { buildStartupsService } from "../src/services/startups.js";
import { buildEmbeddingRegistry } from "../src/llm/embeddings/registry.js";
import { buildSimilarCasesService } from "../src/services/crmMemory/similarCases.js";
import { CRM_MEMORY_GOLDEN_QUERIES } from "../src/services/crmMemory/goldenSet.js";
import {
  hitAtK,
  ndcgAtK,
  recallInTopK,
} from "../src/services/crmMemory/retrievalMetrics.js";
import type { Identity } from "../src/domain/identity.js";

const caller: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const reportPath = join(scriptDir, "..", "docs", "crm-memory-golden-eval-latest.json");

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!config.database.url) {
    throw new Error("DATABASE_URL is required");
  }

  const pgDb = createDb(config.database.url);
  const coreStore = await createPgCoreStore(pgDb);
  const httpConnectors = buildConnectors(config);
  const connectors = buildStoreBackedConnectors(coreStore, httpConnectors);
  const startups = buildStartupsService({ connectors });
  const embeddingRegistry = buildEmbeddingRegistry(config);
  const embeddings = embeddingRegistry.defaultProvider();
  if (!embeddings) {
    throw new Error("Embedding provider is not configured");
  }

  const similarCases = buildSimilarCasesService({
    store: coreStore,
    startups,
    embeddings,
  });

  const results: Array<Record<string, unknown>> = [];
  let ndcgSum = 0;
  let ndcgCount = 0;

  for (const query of CRM_MEMORY_GOLDEN_QUERIES) {
    const start = performance.now();
    const response = await similarCases.findSimilarCases(caller, {
      ...(query.searchTexts !== undefined ? { searchTexts: query.searchTexts } : {}),
      ...(query.noteId !== undefined ? { noteId: query.noteId } : {}),
      ...(query.chunkKind !== undefined ? { chunkKind: query.chunkKind } : {}),
      ...(query.sinceDays !== undefined ? { sinceDays: query.sinceDays } : {}),
      limit: query.limit ?? 10,
    });
    const ms = Math.round(performance.now() - start);

    const retrievedNames = response.data.matches.map((match) => match.name);
    const expectedTop3 = query.expectedTop3 ?? [];
    const expectedInTop10 = query.expectedInTop10 ?? [];

    const ndcg5 =
      expectedTop3.length > 0
        ? ndcgAtK(retrievedNames, expectedTop3, 5)
        : undefined;

    if (ndcg5 !== undefined) {
      ndcgSum += ndcg5;
      ndcgCount += 1;
    }

    const regimeLevel = response.data.regimeSignals?.scoreLevel;
    const regimeOk =
      query.expectLowRegime === true
        ? regimeLevel === "low"
        : query.expectLowRegime === undefined
          ? true
          : regimeLevel !== "low";

    results.push({
      queryId: query.queryId,
      ms,
      searchBasis: response.data.searchBasis,
      top5: retrievedNames.slice(0, 5),
      ndcgAt5: ndcg5,
      hitAt3: expectedTop3.length > 0 ? hitAtK(retrievedNames, expectedTop3, 3) : undefined,
      recallTop10: expectedInTop10.length > 0
        ? recallInTopK(retrievedNames, expectedInTop10, 10)
        : undefined,
      regimeLevel,
      regimeOk,
      noisyTopMatch: response.data.qualitySignals?.noisyTopMatch ?? false,
      topClusterCoherence: response.data.qualitySignals?.topClusterCoherence,
      suggestedRewrite: response.data.suggestedRewrite,
      notes: query.notes,
    });
  }

  const summary = {
    evaluatedAt: new Date().toISOString(),
    queryCount: CRM_MEMORY_GOLDEN_QUERIES.length,
    meanNdcgAt5: ndcgCount > 0 ? Number((ndcgSum / ndcgCount).toFixed(4)) : null,
    regimeChecksPassed: results.filter((row) => row.regimeOk === true).length,
    reportPath,
    results,
  };

  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  await pgDb.end({ timeout: 5 });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
