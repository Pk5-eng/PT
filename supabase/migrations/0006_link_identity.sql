-- 0006_link_identity.sql
--
-- Connects a signed-in Supabase auth user to their row in `people`.
--
-- The trigger stamps every status change with
--   (select id from people where auth_id = auth.uid())
-- so until auth_id is set, every event in the activity feed has a null actor
-- and nobody can tell who moved what.
--
-- A member cannot set it themselves: RLS restricts updates on `people` to
-- admins. This runs as the definer so a member can link their own row, and
-- only their own row, matched on the email they signed in with. It cannot be
-- used to claim someone else's identity: the email comes from the JWT, not
-- from the caller.

begin;

create or replace function link_my_identity() returns uuid as $$
declare
  v_email text;
  v_id uuid;
begin
  select nullif(current_setting('request.jwt.claim.email', true), '') into v_email;
  if v_email is null then
    return null;
  end if;

  -- Claim the matching row only if it is unclaimed or already ours.
  update people
     set auth_id = auth.uid()
   where lower(email) = lower(v_email)
     and active
     and (auth_id is null or auth_id = auth.uid())
  returning id into v_id;

  return v_id;
end $$ language plpgsql security definer set search_path = public;

revoke all on function link_my_identity() from public, anon;
grant execute on function link_my_identity() to authenticated;

insert into schema_migrations (version) values ('0006_link_identity')
  on conflict (version) do nothing;

commit;
