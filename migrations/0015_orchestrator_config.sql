-- Table to store orchestrator configuration
create table if not exists public.gasable_orchestrator (
  id text primary key,
  system_prompt text not null,
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Seed default config (idempotent)
insert into public.gasable_orchestrator (id, system_prompt, rules)
values (
  'default',
  $$You are the Gasable Orchestrator. Your job is to route the user's request to the best agent among the available list. Consider the agent's purpose, the tools they have, and the intent of the request. If an order is being placed, prefer the Procurement agent. If it is general company info or support, prefer Support. If research is requested, prefer Research. If marketing or email content is requested, prefer Marketing. Return only the agent id.$$,
  '{"keywords": {"procurement": ["order","buy","purchase","invoice","checkout"], "research": ["research","analyze","web","find"], "marketing": ["email","campaign","content","marketing"], "support": ["support","help","info","what is","how to"]}}'::jsonb
)
on conflict (id) do update set updated_at=now();


