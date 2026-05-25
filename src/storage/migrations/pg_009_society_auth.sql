-- Society V1 auth — members allowlist + magic link tokens.

create table if not exists society_members (
  member_id text primary key,
  email text not null,
  kind text not null,
  tier text not null,
  investor_id text references investor_records(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint society_members_email_unique unique (email),
  constraint society_members_kind_check check (
    kind in ('society_member', 'founder')
  )
);

create index if not exists idx_society_members_email_lower
  on society_members (lower(email));

create index if not exists idx_society_members_investor
  on society_members (investor_id)
  where investor_id is not null;

create table if not exists society_magic_link_tokens (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_society_magic_link_expires
  on society_magic_link_tokens (expires_at);

create index if not exists idx_startups_browse
  on startups (visibility_tier, name, id);
