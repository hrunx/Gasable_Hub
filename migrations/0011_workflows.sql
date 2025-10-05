-- Workflows table to store drag-and-drop agent graphs

create table if not exists public.gasable_workflows (
	id            text primary key,
	display_name  text not null,
	namespace     text not null default 'global',
	graph         jsonb not null default '{}'::jsonb,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

create index if not exists gasable_workflows_ns_idx on public.gasable_workflows (namespace, id);


