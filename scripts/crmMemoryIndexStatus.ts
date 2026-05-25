import "dotenv/config";
import { createDb } from "../src/storage/pgClient.js";
import { MIN_SEMANTIC_INDEX_BODY_LENGTH } from "../src/services/crmMemory/indexEligibility.js";

const db = createDb(process.env.DATABASE_URL);

const [chunks, indexed, pending, indexable, skippedShort] = await Promise.all([
  db`select count(*)::int as n from knowledge_index_chunks`,
  db`
    select count(*)::int as n from notes
    where startup_id is not null
      and semantic_index_hash is not null
      and semantic_index_hash not like 'skip:%'
  `.catch(() => [{ n: null }]),
  db`
    select count(*)::int as n from notes
    where startup_id is not null
      and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
      and (semantic_index_hash is null or semantic_index_hash = '')
  `.catch(() => [{ n: null }]),
  db`
    select count(*)::int as n from notes
    where startup_id is not null
      and length(trim(body)) >= ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
  `,
  db`
    select count(*)::int as n from notes
    where semantic_index_hash like 'skip:short:%'
  `.catch(() => [{ n: null }]),
]);

await db.end({ timeout: 5 });

const total = indexable[0]?.n ?? 0;
const done = indexed[0]?.n ?? 0;
const pct = total > 0 ? Math.round((done / total) * 100) : 0;

console.log(
  JSON.stringify(
    {
      chunks: chunks[0]?.n ?? 0,
      notesIndexed: done,
      notesPending: pending[0]?.n,
      notesIndexable: total,
      notesSkippedShort: skippedShort[0]?.n,
      minBodyLength: MIN_SEMANTIC_INDEX_BODY_LENGTH,
      progressPct: pct,
      migrationReady: indexed[0]?.n !== null,
    },
    null,
    2,
  ),
);
