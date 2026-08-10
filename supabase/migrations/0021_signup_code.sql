-- 0021_signup_code.sql
--
-- Adds a shared access code to signup: the member types it on the Create
-- account form and the signup trigger checks it server-side. It's the blunt
-- gate the allowlist can't be while Skool→Zapier sync is off — a random person
-- who finds the URL doesn't have the code, and the code is only ever posted
-- inside the community.
--
-- Where the code lives: public.app_config.signup_code (a single-row table, see
-- 0013). It is NEVER shipped to the browser — the client posts whatever the
-- member typed as user metadata and this trigger compares. Admin → Allowlist
-- reads and edits it (admins only, per app_config's RLS).
--
-- Blank or NULL signup_code = the check is off, which is how you turn it off.
--
-- Existing accounts are untouched: this fires on INSERT into auth.users only,
-- so it gates new signups going forward and nobody has to re-enter anything to
-- sign in.
--
-- Idempotent: safe to re-run.

alter table public.app_config
  add column if not exists signup_code text default '3500';

-- Seed the default on a deployment that already had the config row.
update public.app_config set signup_code = '3500' where id and signup_code is null;

-- ── enforce_allowlist(): access code first, then the allowlist ──────────────
-- The code check runs BEFORE the allowlist kill-switch on purpose: the switch
-- exists to open signups to people not yet synced from Skool, and the code is
-- exactly what keeps that open door from being open to everyone.
create or replace function public.enforce_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  supplied text;
begin
  select nullif(btrim(signup_code), '') into expected from public.app_config where id;

  if expected is not null then
    supplied := btrim(coalesce(new.raw_user_meta_data ->> 'signup_code', ''));
    if supplied is distinct from expected then
      raise exception 'That access code is incorrect. You can find it in the Skool community.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Don't keep the code on the user row — it's a shared secret, not a property
  -- of this account, and it would otherwise ride along in the member's own JWT.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'signup_code';

  -- Global kill-switch: when enforcement is disabled, allow any signup.
  -- Treat a missing config row as "enforce" (fail closed).
  if coalesce((select enforce_allowlist from public.app_config where id), true) is false then
    return new;
  end if;

  if not exists (select 1 from public.allowlist where lower(email) = lower(new.email)) then
    raise exception 'Email % is not on the access list. Join the Skool community first.', new.email
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- The trigger itself is unchanged (0001 created it); re-assert it so a fresh
-- environment that runs the migrations in order ends up wired either way.
drop trigger if exists enforce_allowlist_trigger on auth.users;
create trigger enforce_allowlist_trigger
  before insert on auth.users
  for each row execute function public.enforce_allowlist();
