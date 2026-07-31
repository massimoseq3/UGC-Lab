-- 0018_admin_delete_member.sql
--
-- Hard-delete a member from the Admin → Members table. Disabling a member
-- (profiles.disabled_at) locks them out but keeps the account and every row
-- they ever wrote; that's the right tool for a real member who left. It is the
-- wrong tool for a spam signup — those should leave nothing behind.
--
-- Deleting the auth.users row is the whole job: every bank table, the assets
-- metadata rows, usage_days and the profile itself hang off it with
-- `on delete cascade`, so one delete takes the lot. The R2 binaries are NOT
-- reachable from SQL — the client purges `auth/<userId>/` via
-- /api/r2-delete-user BEFORE calling this, so run the two together.
--
-- Why an RPC and not a client-side delete: the anon/authenticated roles have no
-- rights on auth.users at all, and admins only hold a SELECT policy on public
-- tables. SECURITY DEFINER (owner = postgres) is what makes the cascade
-- possible; the is_admin() gate inside is what keeps it safe to expose.
--
-- Guards: caller must be an admin, cannot delete themselves, and cannot delete
-- another admin (drop their is_admin flag first — deliberately a second,
-- separate action).
--
-- NOTE: running `select public.admin_delete_member(...)` in the SQL editor
-- fails the is_admin() gate on purpose — auth.uid() is NULL there, so the
-- editor has no admin identity. Delete straight from auth.users instead.
--
-- Idempotent: safe to re-run.

create or replace function public.admin_delete_member(
  target_id uuid,
  remove_from_allowlist boolean default true
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email    text;
  target_is_admin boolean;
  deleted_count   integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to delete members' using errcode = 'P0001';
  end if;

  if target_id = auth.uid() then
    raise exception 'You cannot delete your own account' using errcode = 'P0001';
  end if;

  select email, is_admin into target_email, target_is_admin
    from public.profiles where id = target_id;

  if target_email is null then
    raise exception 'No member with id %', target_id using errcode = 'P0001';
  end if;

  if target_is_admin then
    raise exception 'Refusing to delete the admin %. Remove their admin flag first.', target_email
      using errcode = 'P0001';
  end if;

  -- Optional: without this the member keeps their signup ticket and can create
  -- a fresh account immediately. Left ON by default in the app.
  if remove_from_allowlist then
    delete from public.allowlist where lower(email) = lower(target_email);
  end if;

  delete from auth.users where id = target_id;

  -- auth.users has RLS enabled and is owned by supabase_auth_admin. On a
  -- correctly provisioned Supabase project the postgres role bypasses that, but
  -- a filtered-away delete would otherwise report success and leave the account
  -- alive (with its allowlist row already gone). Fail loudly instead — the
  -- whole call is one transaction, so the allowlist delete rolls back with it.
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'Could not delete the auth user for % — check that the postgres role can delete from auth.users.', target_email
      using errcode = 'P0001';
  end if;

  return target_email;
end;
$$;

-- Same lockdown shape as 0010: no ambient PUBLIC execute, only signed-in
-- callers (who then have to pass the is_admin() gate inside).
revoke all on function public.admin_delete_member(uuid, boolean) from public;
revoke all on function public.admin_delete_member(uuid, boolean) from anon;
grant execute on function public.admin_delete_member(uuid, boolean) to authenticated;
