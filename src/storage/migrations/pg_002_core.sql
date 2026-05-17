-- Core business data — Postgres.
-- All domain entity tables for HubSpot, Monday and Drive synced data.
-- Date fields stay as text (ISO-8601) to match the TypeScript ISODate = string contract.

create table if not exists startups (
  id text primary key,
  name text not null,
  sectors jsonb not null default '[]',
  stage text not null,
  country text,
  description text,
  visibility_tier text not null,
  sources jsonb not null default '[]',
  synced_at text not null
);

create index if not exists idx_startups_name on startups(name);

create table if not exists portfolio_companies (
  id text primary key,
  startup_id text not null,
  invested_at text not null,
  ownership_pct double precision,
  status text not null,
  synced_at text not null
);

create index if not exists idx_pc_startup on portfolio_companies(startup_id);

create table if not exists deals (
  id text primary key,
  startup_id text not null,
  owner_email text not null,
  status text not null,
  amount_eur double precision,
  updated_at text not null,
  visibility_tier text not null,
  synced_at text not null
);

create index if not exists idx_deals_startup on deals(startup_id, updated_at desc);

create table if not exists notes (
  id text primary key,
  startup_id text,
  author_email text not null,
  body text not null,
  sensitivity text not null,
  created_at text not null,
  source jsonb not null,
  synced_at text not null
);

create index if not exists idx_notes_startup on notes(startup_id, created_at desc);

create table if not exists meetings (
  id text primary key,
  startup_id text,
  attendees jsonb not null default '[]',
  subject text not null,
  occurred_at text not null,
  source jsonb not null,
  synced_at text not null
);

create index if not exists idx_meetings_startup on meetings(startup_id, occurred_at desc);

create table if not exists board_packs (
  id text primary key,
  portfolio_company_id text not null,
  title text not null,
  drive_file_id text not null,
  created_at text not null,
  synced_at text not null
);

create index if not exists idx_board_packs_company on board_packs(portfolio_company_id, created_at desc);

create table if not exists portfolio_signals (
  id text primary key,
  portfolio_company_id text not null,
  kind text not null,
  summary text not null,
  detected_at text not null,
  source_url text,
  visibility_tier text not null,
  synced_at text not null
);

create index if not exists idx_portfolio_signals_company
  on portfolio_signals(portfolio_company_id, detected_at desc);

create table if not exists events (
  id text primary key,
  title text not null,
  starts_at text not null,
  location text,
  visibility text not null,
  invited_investor_ids jsonb not null default '[]',
  synced_at text not null
);

create index if not exists idx_events_starts_at on events(starts_at);

-- Sync run audit: one row per attempt per dataset.
create table if not exists sync_runs (
  id text primary key,
  dataset text not null,
  started_at text not null,
  finished_at text,
  status text not null default 'running',
  records_upserted integer not null default 0,
  error_message text,
  cursor_after text
);

create index if not exists idx_sync_runs_dataset
  on sync_runs(dataset, started_at desc);

-- Materialized freshness per dataset: updated on every successful sync run.
create table if not exists dataset_freshness (
  dataset text primary key,
  last_sync_at text,
  records_total integer not null default 0,
  healthy boolean not null default false,
  updated_at text not null
);
