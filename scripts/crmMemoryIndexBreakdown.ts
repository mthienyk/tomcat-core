import "dotenv/config";
import { createDb } from "../src/storage/pgClient.js";

const main = async (): Promise<void> => {
  const db = createDb(process.env.DATABASE_URL!);
  const rows = await db<
    {
      total_notes: number;
      notes_ge_500: number;
      notes_lt_500: number;
      chunks: number;
      notes_with_vectors: number;
      notes_skipped: number;
      long_notes_indexed: number;
    }[]
  >`
    select
      (select count(*)::int from notes where startup_id is not null) as total_notes,
      (select count(*)::int from notes where startup_id is not null and length(trim(body)) >= 500) as notes_ge_500,
      (select count(*)::int from notes where startup_id is not null and length(trim(body)) < 500) as notes_lt_500,
      (select count(*)::int from knowledge_index_chunks) as chunks,
      (select count(distinct source_id)::int from knowledge_index_chunks where source_kind = 'hubspot_note') as notes_with_vectors,
      (select count(*)::int from notes where semantic_index_hash like 'skip:%') as notes_skipped,
      (select count(*)::int from notes where startup_id is not null
        and length(trim(body)) >= 500
        and semantic_index_hash is not null
        and semantic_index_hash not like 'skip:%') as long_notes_indexed
  `;
  console.log(JSON.stringify(rows[0], null, 2));
  await db.end({ timeout: 5 });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
