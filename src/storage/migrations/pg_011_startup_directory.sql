-- Startup directory classification for Society + MCP (HubSpot lifecycle + deals + Monday portco).

alter table startups
  add column if not exists hubspot_lifecycle text,
  add column if not exists hubspot_company_type text,
  add column if not exists directory_tier text not null default 'excluded';

alter table startups
  drop constraint if exists startups_directory_tier_check;

alter table startups
  add constraint startups_directory_tier_check check (
    directory_tier in ('excluded', 'dealflow', 'invested', 'portfolio', 'alumni')
  );

create index if not exists idx_startups_directory_browse
  on startups (directory_tier, visibility_tier, name, id);
