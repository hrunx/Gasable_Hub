-- Per-agent RAG settings stored as JSONB
alter table if exists public.gasable_agents
  add column if not exists rag_settings jsonb not null default '{}'::jsonb;


