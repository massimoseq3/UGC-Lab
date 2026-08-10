-- 0020_announcements.sql
--
-- Announcements: the operator's broadcast channel inside the app.
--
-- Unlike every other synced table, this one is NOT per-user data. It is ONE
-- global list written only by admins and read by every member, so it does not
-- go through bankStore/cloudSync (which diff-push rows scoped to auth.uid()).
-- The per-user half is `announcement_reads` — one row per member per
-- announcement they've seen, which drives the Dashboard's unread dot and the
-- read receipts in Admin.
--
-- IMPORTANT: run this BEFORE deploying the frontend. Unlike a bank table a
-- missing table here degrades quietly (the store logs and shows nothing), but
-- the Admin tab can't publish until it exists.
--
-- Idempotent: safe to re-run.

-- ── announcements: the global list ─────────────────────────────────────────
create table if not exists public.announcements (
  id            text primary key,
  title         text not null,
  body          text not null default '',

  -- 'update' → red dot on the Dashboard tile only.
  -- 'alert'  → ALSO opens once as a modal the next time the member loads the
  --            app, then never again. For outages and anything time-critical.
  level         text not null default 'update',

  -- A downscaled JPEG data URI, written by the admin editor (see
  -- components/announcements/media.ts — capped there, not here). Deliberately
  -- inline rather than an R2 object: every R2 key is signed under
  -- auth/<userId>/ and scoped to that user, so one shared image would need a
  -- new public prefix in the presign route. The member-side list query never
  -- selects this column — the card fetches its own image on first render.
  image         text,
  -- Lets the list query answer "does this card have a picture?" without
  -- dragging every base64 payload down with it.
  has_image     boolean generated always as (image is not null) stored,

  -- A link to watch (a new YouTube video, most of the time). When it's a
  -- YouTube URL the card derives its thumbnail from the video id, so a video
  -- announcement needs no image upload at all.
  video_url     text,

  -- Optional call to action. Exactly one destination is used: cta_app (a dock
  -- app id — "Try it in Playground") wins over cta_url (any external link).
  cta_label     text,
  cta_url       text,
  cta_app       text,

  -- null = draft (admin-only, never fetched by members). A future timestamp is
  -- a scheduled publish: the member-side policy below only returns rows whose
  -- published_at has actually passed, so scheduling needs no cron.
  published_at  timestamptz,
  -- Optional auto-hide, for anything time-boxed (a maintenance window, an
  -- offer) that would otherwise sit in the log forever.
  expires_at    timestamptz,

  pinned        boolean not null default false,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint announcements_level_check check (level in ('update', 'alert'))
);

-- Re-run safety: `create table if not exists` skips a table that already
-- exists, so a column added after the first deploy needs its own ALTER.
alter table public.announcements
  add column if not exists has_image boolean generated always as (image is not null) stored;

create index if not exists announcements_published_idx
  on public.announcements(published_at desc);

alter table public.announcements enable row level security;

-- Admins do everything.
drop policy if exists "announcements_admin_all" on public.announcements;
create policy "announcements_admin_all" on public.announcements
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Members read only what is live RIGHT NOW: published, not scheduled for the
-- future, not expired. Drafts and scheduled rows are invisible to them, which
-- is what makes "write it now, publish Monday" safe without a scheduler.
drop policy if exists "announcements_member_read" on public.announcements;
create policy "announcements_member_read" on public.announcements
  for select
  using (
    public.is_active()
    and published_at is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
  );

-- ── announcement_reads: who has seen what ──────────────────────────────────
create table if not exists public.announcement_reads (
  user_id          uuid not null references auth.users(id) on delete cascade,
  announcement_id  text not null references public.announcements(id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

create index if not exists announcement_reads_announcement_idx
  on public.announcement_reads(announcement_id);

alter table public.announcement_reads enable row level security;

-- A member writes and reads only their own receipts.
drop policy if exists "announcement_reads_self_all" on public.announcement_reads;
create policy "announcement_reads_self_all" on public.announcement_reads
  for all
  using (auth.uid() = user_id and public.is_active())
  with check (auth.uid() = user_id and public.is_active());

-- Admins read every receipt — that's the "seen by 38 of 62" line in Admin.
-- Read-only on purpose: nobody should be able to mark an announcement read on
-- someone else's behalf.
drop policy if exists "announcement_reads_admin_read" on public.announcement_reads;
create policy "announcement_reads_admin_read" on public.announcement_reads
  for select using (public.is_admin());
