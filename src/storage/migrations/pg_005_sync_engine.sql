-- HubSpot sync engine: durable queue, reconciliation cursors, per-company state.
-- See docs/hubspot-sync-engine.md for design rationale.

create table if not exists sync_queue (
  id text primary key,
  dataset text not null,
  entity_kind text not null,
  entity_id text not null,
  reason text not null,
  priority integer not null default 100,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  scheduled_at text not null,
  locked_at text,
  locked_by text,
  last_error text,
  dedupe_key text not null,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_sync_queue_dedupe_active
  on sync_queue (dedupe_key)
  where status in ('pending', 'running');

create index if not exists idx_sync_queue_claim
  on sync_queue (dataset, status, scheduled_at, priority)
  where status = 'pending';

create index if not exists idx_sync_queue_entity
  on sync_queue (entity_kind, entity_id, updated_at desc);

create table if not exists sync_cursors (
  dataset text not null,
  cursor_key text not null default 'default',
  cursor_value text not null,
  updated_at text not null,
  primary key (dataset, cursor_key)
);

create table if not exists hubspot_company_sync_state (
  company_id text primary key,
  last_activity_sync_at text,
  last_hubspot_modified_at text,
  notes_count integer not null default 0,
  deals_count integer not null default 0,
  meetings_count integer not null default 0,
  notes_fingerprint text,
  updated_at text not null
);

-- Prepared for semantic index (embeddings worker reads changed chunks).
create table if not exists knowledge_index_chunks (
  id text primary key,
  source_kind text not null,
  source_id text not null,
  parent_kind text,
  parent_id text,
  chunk_idx integer not null default 0,
  chunk_text text not null,
  content_hash text not null,
  meta jsonb not null default '{}',
  indexed_at text,
  embedding_model text,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_knowledge_chunks_source
  on knowledge_index_chunks (source_kind, source_id, chunk_idx, content_hash);

create index if not exists idx_knowledge_chunks_parent
  on knowledge_index_chunks (parent_kind, parent_id, updated_at desc);
