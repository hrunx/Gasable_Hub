-- Orchestrator sessions for long-running plans and human-in-the-loop
create extension if not exists pgcrypto;

create table if not exists public.orchestrator_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  status text not null default 'planning',
  message text,
  plan jsonb not null default '{}'::jsonb,
  memory jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orchestrator_sessions_user_idx on public.orchestrator_sessions (user_id, status);

