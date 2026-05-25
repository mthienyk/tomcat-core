-- Semantic CRM memory index (pgvector + note indexing state).

alter table notes
  add column if not exists semantic_index_hash text;

alter table knowledge_index_chunks
  add column if not exists chunk_kind text not null default 'recap',
  add column if not exists embedding vector(1536),
  add column if not exists semantic_model text,
  add column if not exists semantic_schema_version text,
  add column if not exists startup_id text,
  add column if not exists author_email text,
  add column if not exists note_created_at text;

create index if not exists idx_knowledge_chunks_startup
  on knowledge_index_chunks (startup_id, updated_at desc);

create index if not exists idx_knowledge_chunks_author
  on knowledge_index_chunks (author_email, note_created_at desc);

create index if not exists idx_notes_semantic_pending
  on notes (created_at desc)
  where startup_id is not null;

do $$
begin
  create index if not exists idx_knowledge_chunks_embedding
    on knowledge_index_chunks
    using hnsw (embedding vector_cosine_ops);
exception
  when undefined_object then
    raise notice 'pgvector hnsw index skipped: extension unavailable';
  when feature_not_supported then
    raise notice 'pgvector hnsw index skipped: feature not supported';
end $$;
