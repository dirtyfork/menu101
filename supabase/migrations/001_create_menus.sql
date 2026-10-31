-- Run this migration in the Supabase SQL Editor.
create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_name text not null,
  menu_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, menu_name)
);

alter table public.menus enable row level security;

-- New Supabase projects may not grant Data API table access automatically.
-- Authenticated users get table privileges; RLS below still limits each user
-- to rows where user_id matches their own auth.uid(). No anon access is given.
grant select, insert, update, delete on table public.menus to authenticated;
revoke all on table public.menus from anon;

-- Drop and recreate policies so this migration can be safely re-run.
drop policy if exists "Users can read their own menus" on public.menus;
drop policy if exists "Users can create their own menus" on public.menus;
drop policy if exists "Users can update their own menus" on public.menus;
drop policy if exists "Users can delete their own menus" on public.menus;

create policy "Users can read their own menus"
  on public.menus for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own menus"
  on public.menus for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own menus"
  on public.menus for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own menus"
  on public.menus for delete to authenticated
  using (auth.uid() = user_id);
