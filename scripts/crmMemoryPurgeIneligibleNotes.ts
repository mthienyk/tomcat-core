import "dotenv/config";
import { loadConfig } from "../src/config/env.js";
import { createDb } from "../src/storage/pgClient.js";
import { createPgCoreStore } from "../src/storage/pgCoreStore.js";
import {
  MIN_SEMANTIC_INDEX_BODY_LENGTH,
  noteIndexSkipHash,
  parseSemanticIndexState,
} from "../src/services/crmMemory/indexEligibility.js";

type NoteRow = {
  id: string;
  body: string;
  semantic_index_hash: string | null;
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!config.database.url) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(config.database.url);
  const store = await createPgCoreStore(db);

  const shortNotes = await db<NoteRow[]>`
    select id, body, semantic_index_hash
    from notes
    where startup_id is not null
      and length(trim(body)) < ${MIN_SEMANTIC_INDEX_BODY_LENGTH}
  `;

  let shortPurged = 0;
  for (const note of shortNotes) {
    await store.replaceKnowledgeChunksForNote(note.id, []);
    await store.markNoteIndexed(note.id, noteIndexSkipHash("short", note.body));
    shortPurged += 1;
  }

  const opsNotes = await db<
    { id: string; body: string; semantic_index_hash: string | null }[]
  >`
    select distinct n.id, n.body, n.semantic_index_hash
    from knowledge_index_chunks c
    join notes n on n.id = c.source_id
    where c.source_kind = 'hubspot_note'
      and c.meta->>'noteKind' = 'ops'
  `;

  let opsReset = 0;
  for (const note of opsNotes) {
    await store.replaceKnowledgeChunksForNote(note.id, []);
    const state = parseSemanticIndexState(note.semantic_index_hash);
    if (state.kind !== "skipped") {
      await db`
        update notes
        set semantic_index_hash = null
        where id = ${note.id}
      `;
      opsReset += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        purgedShortNotes: shortPurged,
        resetOpsNotesForReindex: opsReset,
        minBodyLength: MIN_SEMANTIC_INDEX_BODY_LENGTH,
        hint:
          "Run the indexing worker to re-process reset ops notes through the new eligibility gate.",
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
