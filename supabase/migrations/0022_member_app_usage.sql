-- 0022_member_app_usage.sql
--
-- Per-app attention time, aggregated for the admin Insights + Members views.
--
-- Everything the admin panel could report until now was derived from OUTPUTS
-- (assets, bank rows, generation counts), which measures what members produced
-- and never what they used — so Outliers, Bank, Edit and the Dashboard itself
-- were invisible, and there was no way to answer "which tool does this member
-- actually live in". The client now records per-app seconds + opens into the
-- existing usage_days ledger under `data->'apps'` (see stores/types.ts
-- UsageDay.apps); this view unpacks that JSONB into one row per member per app
-- so the panel reads ~(members × apps) rows instead of every day row every
-- member has ever written.
--
-- No new table: usage_days already carries the composite PK, the cloud-sync
-- wiring and the admin-read RLS policy this needs.
--
-- `seconds` is measured attention time, not wall-clock — the tracker only
-- accrues while the tab is visible and the member has interacted recently — so
-- treat these as "time spent working in", not "time the tab was open".
--
-- Day ids are 'YYYY-MM-DD' text, which sorts and compares lexically, so the
-- 30-day window is a plain string comparison against to_char(current_date-29).
-- That window is evaluated in UTC while the ids are LOCAL calendar days; a
-- member a few hours either side of UTC can therefore have their oldest or
-- newest day fall on the far side of the boundary. Acceptable for a 30-day
-- roll-up, and not worth carrying a timezone per member to fix.
--
-- security_invoker is REQUIRED (see 0011): without it the view runs as its
-- owner, RLS on usage_days is skipped, and any signed-in member could read
-- every other member's per-app usage from the browser console. With it, the
-- existing usage_days policies apply to the caller — a member sees only their
-- own rows, an admin sees everyone via usage_days_admin_read.
--
-- Idempotent: safe to re-run.

create or replace view public.member_app_usage
with (security_invoker = on) as
  select
    u.user_id,
    e.key                                              as app_id,
    sum(coalesce((e.value->>'seconds')::numeric, 0))::bigint as seconds_total,
    sum(coalesce((e.value->>'opens')::numeric, 0))::bigint   as opens_total,
    sum(case when u.id >= to_char(current_date - 29, 'YYYY-MM-DD')
             then coalesce((e.value->>'seconds')::numeric, 0) else 0 end)::bigint as seconds_30d,
    sum(case when u.id >= to_char(current_date - 29, 'YYYY-MM-DD')
             then coalesce((e.value->>'opens')::numeric, 0) else 0 end)::bigint   as opens_30d,
    max(u.id)                                          as last_day
  from public.usage_days u
  cross join lateral jsonb_each(
    case when jsonb_typeof(u.data->'apps') = 'object' then u.data->'apps' else '{}'::jsonb end
  ) e
  -- Rows written before app tracking shipped have no 'apps' key at all and are
  -- dropped by the lateral join above; this only sheds apps whose entry exists
  -- but recorded nothing (a dock switch with no dwell).
  where coalesce((e.value->>'seconds')::numeric, 0) > 0
     or coalesce((e.value->>'opens')::numeric, 0) > 0
  group by u.user_id, e.key;

-- Defense in depth, matching 0011: anon has no legitimate reason to read this.
-- (RLS already filters anon to zero rows, since auth.uid() is null.)
revoke all on public.member_app_usage from anon;
