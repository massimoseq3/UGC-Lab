-- 0023_lapsed_status.sql
--
-- Adds a THIRD member status, sitting between Active and Disabled: **Lapsed**.
--
--   Active    data intact · app open
--   Lapsed    data intact · app locked · the member lets THEMSELVES back in by
--             typing the current shared access code (redeem_access_code below)
--   Disabled  data intact · app locked · only an admin re-opens it
--
-- Why a third status. Cancelling a membership and banning a spammer are not
-- the same event, and both used to land on profiles.disabled_at. Disabling
-- never destroyed anything — 0012 only gates RLS on the timestamp, so every
-- bank row, asset and history item survives it — but it is a door only the
-- operator can reopen, by hand, per returning member. And the shared access
-- code could never help: enforce_allowlist is a BEFORE INSERT ON auth.users
-- trigger, so it fires on SIGNUP only. A returning member signs IN to the
-- account they already have, which means they were never asked for a code no
-- matter how often it was rotated. Lapsed is the status that makes rotation
-- worth something: the current code is proof of current membership, which is
-- the same logic the signup gate already runs on.
--
-- Nothing here deletes data. Deletion is still admin_delete_member (0018).
--
-- Idempotent: safe to re-run.

-- ── profiles.lapsed_at + the redemption throttle ───────────────────────────
alter table public.profiles
  add column if not exists lapsed_at       timestamptz,
  add column if not exists code_attempts   integer not null default 0,
  add column if not exists code_attempt_at timestamptz;

-- ── is_active(): false while EITHER flag is set ────────────────────────────
-- Same shape as 0012 — a lapsed member's bank rows and assets are locked at
-- the RLS layer, exactly like a disabled one's, until they redeem. profiles
-- itself stays readable (0012's note), which is what lets the app see the
-- lapsed flag and render the code prompt instead of the workspace.
create or replace function public.is_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select disabled_at is null and lapsed_at is null from public.profiles where id = auth.uid()),
    true
  );
$$;

-- ── Guard the new columns against self-service edits ───────────────────────
-- profiles_self_update (0001) lets a member update their own row and does not
-- restrict columns, so without this a lapsed member could simply
-- `update profiles set lapsed_at = null` and skip the code entirely — and
-- reset their own throttle counter while they were at it.
--
-- redeem_access_code is the one legitimate writer. It announces itself with a
-- transaction-local GUC rather than being special-cased by name: PostgREST
-- only exposes functions in the `public` schema and set_config lives in
-- pg_catalog, so a member has no way to set this flag for themselves.
create or replace function public.prevent_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin)
     or (new.disabled_at is distinct from old.disabled_at) then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Not authorized to change is_admin or disabled_at'
        using errcode = 'P0001';
    end if;
  end if;

  if (new.lapsed_at is distinct from old.lapsed_at)
     or (new.code_attempts is distinct from old.code_attempts)
     or (new.code_attempt_at is distinct from old.code_attempt_at) then
    if auth.uid() is not null
       and not public.is_admin()
       and coalesce(current_setting('app.redeeming_code', true), '') <> 'on' then
      raise exception 'Not authorized to change lapsed_at'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_privilege_escalation_trigger on public.profiles;
create trigger prevent_privilege_escalation_trigger
  before update on public.profiles
  for each row execute function public.prevent_privilege_escalation();

-- ── redeem_access_code(): a lapsed member's own way back in ────────────────
-- Returns a jsonb verdict and NEVER raises for a wrong code, deliberately: a
-- raise aborts the transaction, which would roll back the very attempt counter
-- that is meant to throttle guessing. Only "there is no caller" raises.
create or replace function public.redeem_access_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The code is short and shared, so an unthrottled endpoint is a guessing
  -- oracle for anyone holding a lapsed account.
  attempt_window constant interval := interval '1 hour';
  attempt_limit  constant integer  := 5;
  uid       uuid := auth.uid();
  expected  text;
  prof      record;
  attempts  integer;
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = 'P0001';
  end if;

  select disabled_at, lapsed_at, code_attempts, code_attempt_at
    into prof
    from public.profiles
   where id = uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No account found.');
  end if;

  -- A banned account is not a lapsed one. The code is posted in the community,
  -- so without this check every disabled member would hold a way back in.
  if prof.disabled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Your access has been revoked.');
  end if;

  if prof.lapsed_at is null then
    return jsonb_build_object('ok', true);
  end if;

  -- Attempts older than the window start a fresh count.
  attempts := case
    when prof.code_attempt_at is null or prof.code_attempt_at <= now() - attempt_window then 0
    else prof.code_attempts
  end;

  if attempts >= attempt_limit then
    return jsonb_build_object('ok', false, 'error',
      'Too many incorrect codes. Try again in an hour.');
  end if;

  select nullif(btrim(signup_code), '') into expected from public.app_config where id;

  -- Blank code = the signup gate is off. Re-entry then has no secret to check,
  -- so it falls back to being an admin action rather than letting anyone in.
  if expected is null then
    return jsonb_build_object('ok', false, 'error',
      'Re-entry by code is turned off. Ask in the community to be reinstated.');
  end if;

  perform set_config('app.redeeming_code', 'on', true);

  if btrim(coalesce(code, '')) is distinct from expected then
    update public.profiles
       set code_attempts = attempts + 1,
           code_attempt_at = now()
     where id = uid;
    return jsonb_build_object('ok', false,
      'error', 'That access code is incorrect. You can find the current one in the Skool community.',
      'remaining', attempt_limit - (attempts + 1));
  end if;

  update public.profiles
     set lapsed_at = null,
         code_attempts = 0,
         code_attempt_at = null
   where id = uid;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.redeem_access_code(text) from public, anon;
grant execute on function public.redeem_access_code(text) to authenticated;

-- ── Leaving the allowlist now LAPSES rather than disables ──────────────────
-- Removing an email from the allowlist is the cancellation signal (there is no
-- automatic one — Skool exposes no member-removed trigger), and a cancellation
-- should leave a door the member can open themselves. A ban stays a deliberate
-- admin action on the Members table.
--
-- A disabled member who is also dropped from the allowlist stays disabled:
-- lapsing them would DOWNGRADE the ban into a self-service re-entry.
create or replace function public.on_allowlist_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set lapsed_at = now()
   where lower(email) = lower(old.email)
     and lapsed_at is null
     and disabled_at is null;
  return old;
end;
$$;

-- Re-joining clears both flags: an admin re-adding an email is saying this
-- person is a member again, whichever way they left.
create or replace function public.on_allowlist_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set disabled_at = null,
         lapsed_at = null,
         code_attempts = 0,
         code_attempt_at = null
   where lower(email) = lower(new.email);
  return new;
end;
$$;
