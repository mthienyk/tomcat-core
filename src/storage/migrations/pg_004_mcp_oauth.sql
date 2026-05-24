-- MCP OAuth broker — Postgres.
-- Tomcat Core acts as Authorization Server for MCP clients (Cursor, Claude).
-- Google is the upstream Identity Provider. MCP clients never talk to Google.
-- Bearer tokens are opaque random strings; only sha256 hashes are stored.

create table if not exists mcp_oauth_clients (
  client_id text primary key,
  client_secret_hash text,
  client_name text,
  redirect_uris jsonb not null,
  grant_types jsonb not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_pending_authorizes (
  google_state text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  mcp_state text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_pending_expires
  on mcp_oauth_pending_authorizes(expires_at);

create table if not exists mcp_oauth_authorization_codes (
  code_hash text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  principal_email text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scopes text not null default '',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_codes_expires
  on mcp_oauth_authorization_codes(expires_at);

create table if not exists mcp_oauth_tokens (
  token_hash text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  principal_email text not null,
  token_type text not null,
  scopes text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_tokens_principal
  on mcp_oauth_tokens(principal_email);
create index if not exists idx_mcp_oauth_tokens_expires
  on mcp_oauth_tokens(expires_at);
