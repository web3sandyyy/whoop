-- Run once in Supabase → SQL editor.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  whoop_user_id bigint not null unique,
  whoop_access_token text not null,
  whoop_refresh_token text not null,
  whoop_expires_at timestamptz not null,
  google_access_token text,
  google_refresh_token text,
  google_expires_at timestamptz,
  google_calendar_id text,
  created_at timestamptz not null default now()
);

-- Only the server (service role key) may touch this table.
alter table public.users enable row level security;
