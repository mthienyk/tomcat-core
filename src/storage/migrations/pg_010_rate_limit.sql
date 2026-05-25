-- Distributed fixed-window rate limit buckets (Society auth, OAuth, BFF).

create table if not exists rate_limit_buckets (
  bucket text primary key,
  count integer not null,
  window_start timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_rate_limit_buckets_expires
  on rate_limit_buckets (expires_at);
