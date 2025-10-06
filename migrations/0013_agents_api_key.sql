-- Add per-agent API key for external access
alter table if exists public.gasable_agents
  add column if not exists api_key text;

-- Enforce uniqueness when present (partial index)
create unique index if not exists gasable_agents_api_key_idx
  on public.gasable_agents (api_key)
  where api_key is not null;


