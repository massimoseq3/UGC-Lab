-- 0019_swipes.sql
--
-- Swipe file: ads saved from Outliers. A row is the ad's identity (platform +
-- source id + permalink), a snapshot of its numbers AS SAVED, its caption and
-- transcript, and one asset:// ref for the thumbnail we copied into our own
-- storage — every CDN link on the row expires within days, so the thumbnail is
-- the only thing that stops a month-old swipe file rendering as broken images.
--
-- The video itself is deliberately NOT stored (same rule as the B-Rolls bank:
-- stills are saveable, clips are not). A swipe file is meant to hold hundreds
-- of ads and a few MB each would eat the member's 10 GB cap for footage that
-- can be re-fetched from postUrl.
--
-- IMPORTANT: run this BEFORE deploying the frontend — the client hydrates every
-- bank table on sign-in, and a missing table makes hydrate report a per-table
-- error (which also disables the auto orphan sweep for that session).
--
-- Same shape + policies as 0017's styles table. Idempotent: safe to re-run.

create table if not exists public.swipes (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists swipes_user_idx on public.swipes(user_id);

alter table public.swipes enable row level security;

drop policy if exists "swipes_self_all" on public.swipes;
create policy "swipes_self_all" on public.swipes
  for all
  using (auth.uid() = user_id and public.is_active())
  with check (auth.uid() = user_id and public.is_active());

drop policy if exists "swipes_admin_read" on public.swipes;
create policy "swipes_admin_read" on public.swipes
  for select using (public.is_admin());
