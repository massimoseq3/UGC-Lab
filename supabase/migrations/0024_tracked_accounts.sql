-- 0024_tracked_accounts.sql
--
-- Tracked accounts: the creators a member watches in Outliers' Accounts tab.
--
-- A row is the curation plus a snapshot — who is tracked, and what that account
-- was doing (followers, median plays, sample size) at the last refresh — with
-- one asset:// ref for the profile picture we copied into our own storage,
-- because every image url Instagram hands back is signed and expires.
--
-- The REELS are deliberately not stored here. They carry signed CDN urls that
-- rot within days, there can be fifty per account, and one credit re-buys the
-- lot — so Outliers caches them in browser-local state and this table stays a
-- short, durable list worth syncing across a member's devices.
--
-- IMPORTANT: run this BEFORE deploying the frontend — the client hydrates every
-- bank table on sign-in, and a missing table makes hydrate report a per-table
-- error (which also disables the auto orphan sweep for that session).
--
-- Same shape + policies as 0019's swipes table. Idempotent: safe to re-run.

create table if not exists public.tracked_accounts (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tracked_accounts_user_idx on public.tracked_accounts(user_id);

alter table public.tracked_accounts enable row level security;

drop policy if exists "tracked_accounts_self_all" on public.tracked_accounts;
create policy "tracked_accounts_self_all" on public.tracked_accounts
  for all
  using (auth.uid() = user_id and public.is_active())
  with check (auth.uid() = user_id and public.is_active());

drop policy if exists "tracked_accounts_admin_read" on public.tracked_accounts;
create policy "tracked_accounts_admin_read" on public.tracked_accounts
  for select using (public.is_admin());
