import "dotenv/config";
import { createDb } from "../src/storage/pgClient.js";

const db = createDb(process.env.DATABASE_URL);

const [chunks, indexed, pending, indexable] = await Promise.all([
  db`select count(*)::int as n from knowledge_index_chunks`,
  db`
    select count(*)::int as n from notes
    where startup_id is not null and semantic_index_hash is not null
  `.catch(() => [{ n: null }]),
  db`
    select count(*)::int as n from notes
    where startup_id is not null
      and length(trim(body)) >= 100
      and (semantic_index_hash is null or semantic_index_hash = '')
  `.catch(() => [{ n: null }]),
  db`
    select count(*)::int as n from notes
    where startup_id is not null and length(trim(body)) >= 100
  `,
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
      progressPct: pct,
      migrationReady: indexed[0]?.n !== null,
    },
    null,
    2,
  ),
);
