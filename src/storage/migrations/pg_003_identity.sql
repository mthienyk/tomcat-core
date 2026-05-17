-- Identity — Postgres.
-- Internal Tomcat users (authenticated via Google OAuth) and investor records.
-- Investor records are NOT Google accounts — they are referenced by investorId in HumanIdentity.

-- Internal users: Tomcat employees who authenticate via Google.
create table if not exists users (
  email text primary key,
  role text not null,
  team text,
  active boolean not null default true,
  created_at text not null,
  updated_at text not null
);

-- Investor records: the business profile of an investor in Tomcat.
-- investorId in HumanIdentity references id here.
create table if not exists investor_records (
  id text primary key,
  name text not null,
  email text,
  tier text not null,
  sectors_of_interest jsonb not null default '[]',
  created_at text not null,
  updated_at text not null
);

-- Portfolio company assignments per investor.
-- Denormalised portfolioCompanyIds on investor_records is kept in sync on write.
create table if not exists investor_portfolio_assignments (
  investor_id text not null references investor_records(id) on delete cascade,
  portfolio_company_id text not null,
  assigned_at text not null,
  primary key (investor_id, portfolio_company_id)
);

create index if not exists idx_investor_portfolio
  on investor_portfolio_assignments(investor_id);
