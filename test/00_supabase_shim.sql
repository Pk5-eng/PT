-- TEST HARNESS ONLY. Never applied to Supabase - Supabase provides all of this.
--
-- Recreates the parts of a Supabase database that the migrations depend on, so
-- that supabase/migrations/*.sql can be executed and verified against a plain
-- Postgres instance before anyone runs them for real.

-- Supabase's built-in roles.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

-- auth.uid() reads the subject claim from the request JWT. The real one parses
-- request.jwt.claims; this reads a setting the tests set directly.
create schema if not exists auth;

create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ language sql stable;

-- Helper used by the RLS tests to act as a given person.
create or replace function test_become(p_auth_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth_id::text, ''), false);
end $$ language plpgsql;
