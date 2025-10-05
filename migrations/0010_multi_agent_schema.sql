-- Multi-agent schema: namespace columns, 1536 vector path, agents catalog, and audit table

-- 0) Ensure vector extension
create extension if not exists vector;

-- 1) Reuse gasable_index as multi-agent corpus
alter table if exists public.gasable_index
	add column if not exists agent_id text not null default 'default',
	add column if not exists namespace text not null default 'global',
	add column if not exists chunk_index int not null default 0;

-- 2) Ensure 1536-dim embedding column and index
alter table if exists public.gasable_index
	add column if not exists embedding_1536 vector(1536);
create index if not exists gasable_index_hnsw_1536
	on public.gasable_index using hnsw (embedding_1536 vector_cosine_ops);

-- 3) Ensure BM25 tsvector and gin index
alter table if exists public.gasable_index
	add column if not exists tsv tsvector
	generated always as (to_tsvector('simple', coalesce(text, li_metadata->>'chunk'))) stored;
create index if not exists gasable_index_tsv_idx on public.gasable_index using gin (tsv);

-- 4) Namespace filtering index
create index if not exists gasable_index_agent_ns_idx
	on public.gasable_index (agent_id, namespace);

-- 5) Agents catalog
create table if not exists public.gasable_agents (
	id             text primary key,
	display_name   text not null,
	namespace      text not null default 'global',
	system_prompt  text not null,
	tool_allowlist text[] not null default '{}',
	answer_model   text not null default 'gpt-5-mini',
	rerank_model   text not null default 'gpt-5-mini',
	top_k          int  not null default 12,
	assistant_id   text,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);

-- Seed two agents (idempotent)
insert into public.gasable_agents (id, display_name, system_prompt, tool_allowlist)
values
 ('support','Gasable Support','You are Gasable Customer Care. Verify identity before personal actions. Be concise.', '{rag.search}')
,('procurement','Gasable Procurement','You place orders safely: validate product/qty/user/address and return invoice JSON.', '{rag.search,orders.place}')
on conflict (id) do nothing;

-- 6) Orchestration audit
create table if not exists public.agent_runs (
	id              bigserial primary key,
	user_id         text,
	selected_agent  text not null,
	namespace       text not null default 'global',
	user_message    text not null,
	run_status      text not null default 'completed',
	openai_thread_id text,
	openai_run_id    text,
	result_summary   text,
	tool_calls      jsonb not null default '[]'::jsonb,
	created_at      timestamptz not null default now()
);
create index if not exists agent_runs_ns_idx on public.agent_runs (namespace, selected_agent, created_at desc);


