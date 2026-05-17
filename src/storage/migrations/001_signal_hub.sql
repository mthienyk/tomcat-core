-- Signal Hub schema — SQLite implementation.
-- Field types chosen to be losslessly portable to Postgres:
-- TEXT ids → uuid primary key
-- TEXT JSON → jsonb
-- TEXT datetimes → timestamptz (ISO-8601 strings)

create table if not exists watched_entities (
  id text primary key,
  startup_id text,
  display_name text not null,
  linkedin_url text,
  linkedin_identifier text,
  kind text not null default 'person',
  priority text not null default 'warm',
  created_at text not null default (datetime('now'))
);

create table if not exists signal_events (
  id text primary key,
  source text not null,
  signal_type text not null,
  watched_id text references watched_entities(id),
  startup_id text,
  unipile_account_id text,
  emitted_at text,
  ingested_at text not null default (datetime('now')),
  url text,
  raw_text text,
  raw_payload text not null,
  content_hash text not null,
  unique (source, signal_type, content_hash)
);

create index if not exists idx_events_watched
  on signal_events(watched_id, ingested_at desc);

create index if not exists idx_events_startup
  on signal_events(startup_id, ingested_at desc);

create index if not exists idx_events_source_type
  on signal_events(source, signal_type, ingested_at desc);

create table if not exists unipile_accounts (
  account_id text primary key,
  label text not null,
  state text not null default 'active',
  frozen_until text,
  daily_quota integer not null default 60,
  killed_reason text,
  updated_at text not null default (datetime('now'))
);

create table if not exists unipile_account_status_events (
  id text primary key,
  account_id text not null references unipile_accounts(account_id),
  status text not null,
  raw_payload text not null,
  received_at text not null default (datetime('now'))
);

create index if not exists idx_status_events_account
  on unipile_account_status_events(account_id, received_at desc);
