-- 0017_styles.sql
--
-- Styles bank: the visual looks B-Roll distils from reference frames. A row is
-- a name + the style paragraph + up to four asset:// refs for the frames it was
-- read from, so a member can re-apply a look they built once to any later
-- storyboard instead of re-uploading and re-analysing the same references.
--
-- IMPORTANT: run this BEFORE deploying the frontend — the client hydrates every
-- bank table on sign-in, and a missing table makes hydrate report a per-table
-- error (which also disables the auto orphan sweep for that session).
--
-- Same shape + policies as 0014's tables (self policy bakes in is_active(),
-- admin read for the Members/Insights views). Idempotent: safe to re-run.

create table if not exists public.styles (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists styles_user_idx on public.styles(user_id);

alter table public.styles enable row level security;

drop policy if exists "styles_self_all" on public.styles;
create policy "styles_self_all" on public.styles
  for all
  using (auth.uid() = user_id and public.is_active())
  with check (auth.uid() = user_id and public.is_active());

drop policy if exists "styles_admin_read" on public.styles;
create policy "styles_admin_read" on public.styles
  for select using (public.is_admin());
