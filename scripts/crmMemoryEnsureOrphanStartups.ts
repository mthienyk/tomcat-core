import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { buildConnectors } from "../src/connectors/registry.js";
import { createDb } from "../src/storage/pgClient.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import {
  ensureHubspotStartupForCompany,
  listStartupIdsMissingFromNotes,
} from "../src/sync/ensureHubspotStartup.js";

const config = loadConfig();
const db = createDb(process.env.DATABASE_URL);
const store = await createPgCoreStore(db);
const connectors = buildConnectors(config);

const missingIds = await listStartupIdsMissingFromNotes(store);
const results: Array<{
  companyId: string;
  result: Awaited<ReturnType<typeof ensureHubspotStartupForCompany>>;
}> = [];

for (const companyId of missingIds) {
  const result = await ensureHubspotStartupForCompany({
    store,
    connectors,
    companyId,
  });
  results.push({ companyId, result });
}

await db.end({ timeout: 5 });

const created = results.filter((r) => r.result === "created");
const exists = results.filter((r) => r.result === "exists");
const missing = results.filter((r) => r.result === "missing");

console.log(
  JSON.stringify(
    {
      orphanCompanyIds: missingIds.length,
      created: created.length,
      alreadyExists: exists.length,
      hubspotMissing: missing.length,
      details: results,
    },
    null,
    2,
  ),
);
