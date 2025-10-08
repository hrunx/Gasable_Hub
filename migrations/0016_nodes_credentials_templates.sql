-- Nodes registry (versioned)
create table if not exists public.nodes (
  name text not null,
  version text not null,
  title text not null,
  category text not null,
  spec jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (name, version)
);

-- Credentials (encrypted at rest; ciphertext stored)
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  label text not null,
  data_enc bytea not null,
  scopes text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Templates (prebuilt workflows in canvas format)
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  description text,
  category text not null,
  graph jsonb not null,
  source text,
  created_at timestamptz not null default now()
);


