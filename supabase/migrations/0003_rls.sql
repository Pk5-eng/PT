-- 0003_rls.sql
-- Row Level Security. The spec states these policies in prose (section 3,
-- "Row Level Security"); this is that prose implemented.
--
-- There is no backend server, so RLS is the entire authorisation boundary.
-- Anything not granted here is denied: RLS is default-deny once enabled.
--
-- DEVIATION FROM SPEC, deliberate: the spec's list of `enable row level
-- security` statements omits project_deliverable, while its policy prose
-- grants insert/update on it. Left as written, project_deliverable would be
-- the one table with RLS off - readable and writable by anyone holding the
-- public anon key. It is enabled below.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

alter table people             enable row level security;
alter table projects           enable row level security;
alter table stage_groups       enable row level security;
alter table substages          enable row level security;
alter table deliverables       enable row level security;
alter table project_substage   enable row level security;
alter table project_deliverable enable row level security;  -- see note above
alter table assignments        enable row level security;
alter table blocks             enable row level security;
alter table events             enable row level security;

-- Admin test. SECURITY DEFINER so that the policy on `people` can consult
-- `people` without recursing through that same policy.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from people
    where auth_id = auth.uid() and role = 'admin' and active
  );
$$ language sql stable security definer set search_path = public;

-- 1. Any authenticated user reads every table.
create policy read_all on people             for select to authenticated using (true);
create policy read_all on projects           for select to authenticated using (true);
create policy read_all on stage_groups       for select to authenticated using (true);
create policy read_all on substages          for select to authenticated using (true);
create policy read_all on deliverables       for select to authenticated using (true);
create policy read_all on project_substage   for select to authenticated using (true);
create policy read_all on project_deliverable for select to authenticated using (true);
create policy read_all on assignments        for select to authenticated using (true);
create policy read_all on blocks             for select to authenticated using (true);
create policy read_all on events             for select to authenticated using (true);

-- 2. Any authenticated user may insert and update the operational tables.
create policy write_any on projects           for insert to authenticated with check (true);
create policy edit_any  on projects           for update to authenticated using (true) with check (true);

create policy write_any on project_substage   for insert to authenticated with check (true);
create policy edit_any  on project_substage   for update to authenticated using (true) with check (true);

create policy write_any on project_deliverable for insert to authenticated with check (true);
create policy edit_any  on project_deliverable for update to authenticated using (true) with check (true);

create policy write_any on assignments        for insert to authenticated with check (true);
create policy edit_any  on assignments        for update to authenticated using (true) with check (true);

create policy write_any on blocks             for insert to authenticated with check (true);
create policy edit_any  on blocks             for update to authenticated using (true) with check (true);

-- Assignments and blocks are the two operational tables where removal is a
-- normal act rather than history loss: taking someone off a project, or
-- deleting a block raised by mistake. Everything else clears by an `active`
-- flag or a `cleared_on` date.
create policy del_any on assignments for delete to authenticated using (true);
create policy del_any on blocks      for delete to authenticated using (true);

-- 3. Only an admin touches the taxonomy and the people list.
create policy admin_write on stage_groups for insert to authenticated with check (is_admin());
create policy admin_edit  on stage_groups for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_write on substages    for insert to authenticated with check (is_admin());
create policy admin_edit  on substages    for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_write on deliverables for insert to authenticated with check (is_admin());
create policy admin_edit  on deliverables for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_write on people       for insert to authenticated with check (is_admin());
create policy admin_edit  on people       for update to authenticated using (is_admin()) with check (is_admin());

-- 4. Nobody deletes the taxonomy or the audit log. No delete policy exists for
-- these, which is already default-deny; the revoke makes it true at the grant
-- level too, so a future permissive policy cannot quietly re-open it.
revoke delete on stage_groups, substages, deliverables, events from authenticated, anon;

-- 5. events accepts inserts only from stamp_and_log(), which is SECURITY
-- DEFINER and therefore runs as the table owner, bypassing RLS. No insert or
-- update policy is defined here, so no client can write or amend an event.
revoke insert, update on events from authenticated, anon;

-- projects has `on delete cascade` children, so a project delete would take
-- its events with it. No delete policy is defined for projects: closing one is
-- a status change to 'completed' or 'cancelled'.

-- The board view runs as its creator. Restrict it to signed-in users so it
-- cannot be read with the anon key alone.
revoke all on v_board from anon;
grant select on v_board to authenticated;

commit;
