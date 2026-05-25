import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { buildStoreBackedConnectors } from "../src/connectors/storeBacked.js";
import { createDb } from "../src/storage/pgClient.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import { buildStartupsService } from "../src/services/startups.js";
import { buildEmbeddingRegistry } from "../src/llm/embeddings/registry.js";
import { buildSimilarCasesService } from "../src/services/crmMemory/similarCases.js";
import type { Identity } from "../src/domain/identity.js";

const caller: Identity = {
  kind: "human",
  email: "mcp@tomcat.eu",
  domain: "tomcat.eu",
  role: "internal_team",
  team: undefined,
  investorId: undefined,
};

const cases = [
  {
    label: "searchTexts payroll B2B",
    args: {
      searchTexts: [
        "M1 — SaaS paie/RH pour PME, canal expert-comptable, churn élevé sur segment self-serve, question sur NRR et wedge vs PayFit.",
        "Investment lens: marché payroll SMB saturé, intérêt si canal comptable crédible et rétention cohorte >100%.",
      ],
      authorEmail: "elie.dupredesaintmaur@tomcat.eu",
      sinceDays: 1095,
      limit: 5,
    },
  },
  {
    label: "query payroll B2B (direct embed)",
    args: {
      query: "payroll RH B2B SaaS PME expert-comptable churn",
      authorEmail: "elie.dupredesaintmaur@tomcat.eu",
      sinceDays: 1095,
      limit: 5,
    },
  },
  {
    label: "noteId Favikon anchor",
    args: {
      noteId: "84190149041",
      limit: 5,
    },
  },
] as const;

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

  const results: Array<{
    label: string;
    ms: number;
    matchCount: number;
    topMatches: string[];
    searchBasis: string;
  }> = [];

  for (const testCase of cases) {
    const start = performance.now();
    const result = await similarCases.findSimilarCases(caller, { ...testCase.args });
    const ms = Math.round(performance.now() - start);

    results.push({
      label: testCase.label,
      ms,
      matchCount: result.data.matchCount,
      topMatches: result.data.matches.slice(0, 3).map((m) => m.name),
      searchBasis: result.data.searchBasis,
    });
  }

  console.log(JSON.stringify({ benchmark: results }, null, 2));
  await pgDb.end({ timeout: 5 });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
