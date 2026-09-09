-- ============================================================================
-- Kabra Architects dashboard - THE MIGRATION FILE
--
-- This is the only file you ever paste into the Supabase SQL editor, and you
-- paste the whole of it every time, whatever state the database is in.
--
--   a brand new project        -> it builds the whole schema
--   a database a few behind    -> it applies only what is missing
--   a database already current -> it changes nothing
--   pasted twice by mistake    -> it changes nothing
--
-- That is the point. There is no backend and no migration runner, so applying
-- a migration is a person pasting a file, and a person should never have to
-- work out WHICH file. Every migration below is idempotent, so there is only
-- ever one answer: this one.
--
-- Each migration is its own transaction, so a failure rolls back that file only
-- and the error names which one. Afterwards, run VERIFY.sql to see where the
-- database is.
--
-- Generated file. Do not edit. Edit the numbered migrations and run:
--     npm run build:migrations
-- ============================================================================


-- ############################################################################
-- ## 0001_schema.sql
-- ############################################################################

-- 0001_schema.sql
-- Base schema, verbatim from KA_DASHBOARD_BUILD_SPEC.md section 3.
-- Apply first, in the Supabase SQL editor or via the CLI.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

create extension if not exists "pgcrypto";

-- Which migrations this database has had applied. Not a gate - every migration
-- in this directory is idempotent and re-running one is a no-op - but a record,
-- so VERIFY.sql can answer "is this database current?" without anyone having to
-- remember. Kept out of PostgREST entirely: it is operational metadata and no
-- browser has any business reading it.
create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;
revoke all on schema_migrations from anon, authenticated;

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  name text not null,
  email text unique,
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  client_name text,
  type text not null check (type in ('AR','ID','IR')),
  status text not null default 'ongoing'
    check (status in ('ongoing','hold','npp','not_confirmed','completed','cancelled')),
  priority int check (priority between 0 and 3),
  site_location text,
  created_at timestamptz not null default now(),
  created_by uuid references people(id)
);

create table if not exists stage_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seq int not null,
  active boolean not null default true
);

create table if not exists substages (
  id uuid primary key default gen_random_uuid(),
  stage_group_id uuid not null references stage_groups(id),
  name text not null,
  seq int not null,
  planned_weeks numeric,
  active boolean not null default true
);

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  substage_id uuid not null references substages(id),
  name text not null,
  seq int not null default 0,
  active boolean not null default true
);

create table if not exists project_substage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid not null references substages(id),
  status text not null default 'not_started'
    check (status in ('not_in_scope','not_started','in_process','done','hold','cancelled')),
  started_on date,
  concluded_on date,
  unique (project_id, substage_id)
);

create table if not exists project_deliverable (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  deliverable_id uuid not null references deliverables(id),
  done boolean not null default false,
  done_on date,
  unique (project_id, deliverable_id)
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id),
  role_code text not null check (role_code in ('PI','DD','WD','PE','CL','INVOLVED')),
  unique (project_id, person_id)
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  owner text not null check (owner in ('client','authority','consultant','contractor','internal')),
  reason text not null,
  raised_on date not null default current_date,
  raised_by uuid references people(id),
  cleared_on date
);

create table if not exists events (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid references substages(id),
  actor_id uuid references people(id),
  from_status text,
  to_status text,
  at timestamptz not null default now()
);

create index if not exists project_substage_project_id_idx
  on project_substage (project_id);
create index if not exists events_project_id_at_idx
  on events (project_id, at desc);
create index if not exists assignments_person_id_idx
  on assignments (person_id);

-- Not in the spec's SQL, but the taxonomy is looked up by (stage_group, name)
-- during seeding and by seq on every board read.
create index if not exists substages_stage_group_id_seq_idx
  on substages (stage_group_id, seq);
create index if not exists deliverables_substage_id_seq_idx
  on deliverables (substage_id, seq);

insert into schema_migrations (version) values ('0001_schema')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0002_trigger_and_view.sql
-- ############################################################################

-- 0002_trigger_and_view.sql
-- The stamping trigger and the board view, verbatim from spec section 3.
--
-- The trigger is the reason users never type a date. It fires only on UPDATE,
-- which is correct for the app (rows are created 'not_started' and moved by the
-- dropdown) but means the seed script must set started_on / concluded_on itself
-- on INSERT. See scripts/seed.mjs.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

create or replace function stamp_and_log() returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_process' and new.started_on is null then
      new.started_on := current_date;
    end if;
    if new.status = 'done' and new.concluded_on is null then
      new.concluded_on := current_date;
    end if;
    if new.status <> 'done' then
      new.concluded_on := null;
    end if;
    insert into events (project_id, substage_id, actor_id, from_status, to_status)
    values (new.project_id, new.substage_id,
            (select id from people where auth_id = auth.uid()),
            old.status, new.status);
  end if;
  return new;
end $$ language plpgsql security definer;

drop trigger if exists trg_stamp_and_log on project_substage;

create trigger trg_stamp_and_log
  before update on project_substage
  for each row execute function stamp_and_log();

-- Dropped rather than replaced: `create or replace view` cannot change a
-- view's column list, and migration 0012 gives v_board a different one. On a
-- re-run this would otherwise fail here, before reaching the migration that
-- defines the shape actually wanted.
drop view if exists v_board;

create view v_board as
with current_sub as (
  select distinct on (ps.project_id)
    ps.project_id, ps.substage_id, ps.status, ps.started_on,
    s.name as substage_name, s.planned_weeks, sg.name as stage_group_name
  from project_substage ps
  join substages s on s.id = ps.substage_id
  join stage_groups sg on sg.id = s.stage_group_id
  where ps.status = 'in_process'
  order by ps.project_id, sg.seq, s.seq
)
select
  p.id, p.name, p.code, p.type, p.status, p.priority,
  c.substage_name, c.stage_group_name, c.planned_weeks,
  c.started_on,
  case when c.started_on is null then null
       else current_date - c.started_on end as days_in_substage,
  case when c.started_on is null or c.planned_weeks is null then null
       else (current_date - c.started_on) - round(c.planned_weeks * 7) end as days_over,
  (select b.owner from blocks b
    where b.project_id = p.id and b.cleared_on is null
    order by b.raised_on limit 1) as blocked_by
from projects p
left join current_sub c on c.project_id = p.id;

insert into schema_migrations (version) values ('0002_trigger_and_view')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0003_rls.sql
-- ############################################################################

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

-- Every policy below is preceded by a drop. `create policy` has no `if not
-- exists` and errors on a name that is already taken, which made this file
-- single-use; dropping first makes the whole thing converge instead.

-- Admin test. SECURITY DEFINER so that the policy on `people` can consult
-- `people` without recursing through that same policy.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from people
    where auth_id = auth.uid() and role = 'admin' and active
  );
$$ language sql stable security definer set search_path = public;

-- 1. Any authenticated user reads every table.
drop policy if exists read_all on people;
create policy read_all on people             for select to authenticated using (true);
drop policy if exists read_all on projects;
create policy read_all on projects           for select to authenticated using (true);
drop policy if exists read_all on stage_groups;
create policy read_all on stage_groups       for select to authenticated using (true);
drop policy if exists read_all on substages;
create policy read_all on substages          for select to authenticated using (true);
drop policy if exists read_all on deliverables;
create policy read_all on deliverables       for select to authenticated using (true);
drop policy if exists read_all on project_substage;
create policy read_all on project_substage   for select to authenticated using (true);
drop policy if exists read_all on project_deliverable;
create policy read_all on project_deliverable for select to authenticated using (true);
drop policy if exists read_all on assignments;
create policy read_all on assignments        for select to authenticated using (true);
drop policy if exists read_all on blocks;
create policy read_all on blocks             for select to authenticated using (true);
drop policy if exists read_all on events;
create policy read_all on events             for select to authenticated using (true);

-- 2. Any authenticated user may insert and update the operational tables.
drop policy if exists write_any on projects;
create policy write_any on projects           for insert to authenticated with check (true);
drop policy if exists edit_any on projects;
create policy edit_any  on projects           for update to authenticated using (true) with check (true);

drop policy if exists write_any on project_substage;
create policy write_any on project_substage   for insert to authenticated with check (true);
drop policy if exists edit_any on project_substage;
create policy edit_any  on project_substage   for update to authenticated using (true) with check (true);

drop policy if exists write_any on project_deliverable;
create policy write_any on project_deliverable for insert to authenticated with check (true);
drop policy if exists edit_any on project_deliverable;
create policy edit_any  on project_deliverable for update to authenticated using (true) with check (true);

drop policy if exists write_any on assignments;
create policy write_any on assignments        for insert to authenticated with check (true);
drop policy if exists edit_any on assignments;
create policy edit_any  on assignments        for update to authenticated using (true) with check (true);

drop policy if exists write_any on blocks;
create policy write_any on blocks             for insert to authenticated with check (true);
drop policy if exists edit_any on blocks;
create policy edit_any  on blocks             for update to authenticated using (true) with check (true);

-- Assignments and blocks are the two operational tables where removal is a
-- normal act rather than history loss: taking someone off a project, or
-- deleting a block raised by mistake. Everything else clears by an `active`
-- flag or a `cleared_on` date.
drop policy if exists del_any on assignments;
create policy del_any on assignments for delete to authenticated using (true);
drop policy if exists del_any on blocks;
create policy del_any on blocks      for delete to authenticated using (true);

-- 3. Only an admin touches the taxonomy and the people list.
drop policy if exists admin_write on stage_groups;
create policy admin_write on stage_groups for insert to authenticated with check (is_admin());
drop policy if exists admin_edit on stage_groups;
create policy admin_edit  on stage_groups for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_write on substages;
create policy admin_write on substages    for insert to authenticated with check (is_admin());
drop policy if exists admin_edit on substages;
create policy admin_edit  on substages    for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_write on deliverables;
create policy admin_write on deliverables for insert to authenticated with check (is_admin());
drop policy if exists admin_edit on deliverables;
create policy admin_edit  on deliverables for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists admin_write on people;
create policy admin_write on people       for insert to authenticated with check (is_admin());
drop policy if exists admin_edit on people;
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

insert into schema_migrations (version) values ('0003_rls')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0004_target_date.sql
-- ############################################################################

-- 0004_target_date.sql
--
-- DEVIATION FROM SPEC SECTION 3, agreed in the Phase 0 review.
--
-- The spreadsheet records two different kinds of date in one column: a date on
-- a coloured (done) cell is when work concluded, and a date on an uncoloured or
-- in-process cell is when it is expected to conclude. The spec's schema has a
-- home for the first and none for the second.
--
-- Without this column those five dates are lost. Worse, storing them in
-- concluded_on would have been silently destructive: stamp_and_log() sets
-- concluded_on to null on any status change away from 'done', so the first time
-- anyone touched the dropdown the target would vanish with no trace.
--
-- target_date is deliberately NOT touched by the trigger. It is the one date a
-- user is allowed to author, because it is a plan rather than a record of what
-- happened. CLAUDE.md rule 2 governs started_on and concluded_on, which remain
-- stamped and unauthorable.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

alter table project_substage add column if not exists target_date date;

comment on column project_substage.target_date is
  'When this substage is expected to conclude. User-set, unlike started_on and '
  'concluded_on which the trigger stamps. Never cleared automatically.';

-- Rebuild the board view to surface it.
--
-- Dropped and recreated rather than `create or replace view`: replace can only
-- append columns to the end of a view, and target_date belongs next to
-- started_on. A view holds no data, so dropping it costs nothing, but the
-- grants go with it and are reapplied at the foot of this file.
--
-- This also does real work for the launch problem in docs/PHASE0_AUDIT.md D1:
-- no row has started_on, so days_over is null for all 37 projects and the
-- board's sort key is empty on day one. days_past_target gives the board a
-- second, independent signal that has actual data behind it from the start.
drop view if exists v_board;

create view v_board as
with current_sub as (
  select distinct on (ps.project_id)
    ps.project_id, ps.substage_id, ps.status, ps.started_on, ps.target_date,
    s.name as substage_name, s.planned_weeks, sg.name as stage_group_name
  from project_substage ps
  join substages s on s.id = ps.substage_id
  join stage_groups sg on sg.id = s.stage_group_id
  where ps.status = 'in_process'
  order by ps.project_id, sg.seq, s.seq
)
select
  p.id, p.name, p.code, p.type, p.status, p.priority,
  c.substage_name, c.stage_group_name, c.planned_weeks,
  c.started_on,
  c.target_date,
  case when c.started_on is null then null
       else current_date - c.started_on end as days_in_substage,
  case when c.started_on is null or c.planned_weeks is null then null
       else (current_date - c.started_on) - round(c.planned_weeks * 7) end as days_over,
  case when c.target_date is null then null
       else current_date - c.target_date end as days_past_target,
  (select b.owner from blocks b
    where b.project_id = p.id and b.cleared_on is null
    order by b.raised_on limit 1) as blocked_by
from projects p
left join current_sub c on c.project_id = p.id;

revoke all on v_board from anon;
grant select on v_board to authenticated;

insert into schema_migrations (version) values ('0004_target_date')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0005_board_most_overdue.sql
-- ############################################################################

-- 0005_board_most_overdue.sql
--
-- Redefines v_board so a project's row shows the substage that is actually
-- stuck, not the one that happens to come first in the stage order.
--
-- Why: 10 of the 17 projects with active work have more than one substage in
-- process, and Ashok Ranka has seven. The original view picked the earliest by
-- (stage_group.seq, substage.seq), so a project could show as sitting in
-- ELEVATION FINALISATION while the real delay was in SERVICES DRAWING, and the
-- board silently reported about a third of live work.
--
-- The row now carries active_substage_count so the UI can say "+6 more" and be
-- honest about what it is not showing. One row per project is preserved.
--
-- Ranking within a project, in order:
--   1. days_over        - furthest past its planned duration
--   2. days_past_target - furthest past its target date
--   3. stage order      - the original tie-break, used when neither is known
--
-- On day one every days_over is null, because nothing in the spreadsheet
-- recorded a start date, so rule 2 does the work and rule 3 catches the rest.
-- As statuses get moved in the app, started_on accumulates and rule 1 takes
-- over. The board improves on its own without anyone backfilling anything.

begin;

drop view if exists v_board;

create view v_board as
with active as (
  select
    ps.project_id,
    ps.substage_id,
    ps.started_on,
    ps.target_date,
    s.name        as substage_name,
    s.planned_weeks,
    sg.name       as stage_group_name,
    sg.seq        as group_seq,
    s.seq         as substage_seq,
    case when ps.started_on is null then null
         else current_date - ps.started_on end as days_in_substage,
    case when ps.started_on is null or s.planned_weeks is null then null
         else (current_date - ps.started_on) - round(s.planned_weeks * 7) end as days_over,
    case when ps.target_date is null then null
         else current_date - ps.target_date end as days_past_target
  from project_substage ps
  join substages s      on s.id  = ps.substage_id
  join stage_groups sg  on sg.id = s.stage_group_id
  where ps.status = 'in_process'
),
worst as (
  select distinct on (project_id)
    project_id, substage_id, substage_name, stage_group_name,
    planned_weeks, started_on, target_date,
    days_in_substage, days_over, days_past_target,
    count(*) over (partition by project_id) as active_substage_count
  from active
  order by
    project_id,
    days_over        desc nulls last,
    days_past_target desc nulls last,
    group_seq, substage_seq
)
select
  p.id, p.name, p.code, p.type, p.status, p.priority,
  w.substage_name,
  w.stage_group_name,
  w.planned_weeks,
  w.started_on,
  w.target_date,
  w.days_in_substage,
  w.days_over,
  w.days_past_target,
  coalesce(w.active_substage_count, 0) as active_substage_count,
  -- Distinguishes a project that has finished every substage from one that has
  -- no stage data at all. Both show no current substage, and on the old view
  -- both read as "Not set", which conflated 2 completed projects with 20 empty
  -- ones. See docs/PHASE1_VERIFICATION.md.
  (select count(*) from project_substage ps2 where ps2.project_id = p.id) as substage_count,
  (select count(*) from project_substage ps2
    where ps2.project_id = p.id and ps2.status = 'done') as done_count,
  (select b.owner from blocks b
    where b.project_id = p.id and b.cleared_on is null
    order by b.raised_on limit 1) as blocked_by
from projects p
left join worst w on w.project_id = p.id;

revoke all on v_board from anon;
grant select on v_board to authenticated;

insert into schema_migrations (version) values ('0005_board_most_overdue')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0006_link_identity.sql
-- ############################################################################

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

-- ############################################################################
-- ## 0007_deliverable_stamp.sql
-- ############################################################################

-- 0007_deliverable_stamp.sql
--
-- Stamps project_deliverable.done_on, for the same reason stamp_and_log()
-- stamps the substage dates: rule 2, dates are never authored by a user.
--
-- Without this the browser would decide when a deliverable was finished, and a
-- client clock, a stale tab or a timezone would be able to write a date the
-- database never agreed to. Ticking the box is the whole interaction; the date
-- is a consequence of it.
--
-- Unticking clears the date rather than leaving a completion date on something
-- that is not complete.

begin;

create or replace function stamp_deliverable() returns trigger as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_on := current_date;
  elsif not new.done then
    new.done_on := null;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_stamp_deliverable on project_deliverable;

create trigger trg_stamp_deliverable
  before insert or update on project_deliverable
  for each row execute function stamp_deliverable();

insert into schema_migrations (version) values ('0007_deliverable_stamp')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0008_working_days.sql
-- ############################################################################

-- 0008_working_days.sql
--
-- The studio does not work on Sundays, so a duration measured in calendar days
-- overstates every piece of work by roughly a seventh. Asked for explicitly:
-- "in the calculation of total days spent on a project do not include sundays".
--
-- This is deliberately one function rather than a rule applied in three places.
-- The board, the project screen and the analytics screen must never disagree
-- about how long something has taken, and the only way to guarantee that is for
-- all three to read the same number out of the same view.
--
-- Counting, not eyeballing: the number of Sundays in (a, b] is the difference of
-- two floor-divisions anchored on a known Sunday. 2000-01-02 was a Sunday.
-- floor() on numeric behaves correctly for dates before the anchor; integer `/`
-- in Postgres truncates towards zero and would be wrong there, so the division
-- is done in numeric on purpose.
--
--   working_days('2026-09-07', '2026-09-14') = 7 - 1 = 6   (one Sunday between)
--
-- IMMUTABLE, and therefore usable inside a view and an index. It reads no table
-- and no clock: the caller passes current_date in, it is never read in here.

begin;

create or replace function working_days(from_date date, to_date date)
returns int as $$
  select case
    when from_date is null or to_date is null then null
    else (to_date - from_date)
       - ( floor((to_date   - date '2000-01-02') / 7.0)::int
         - floor((from_date - date '2000-01-02') / 7.0)::int )
  end;
$$ language sql immutable;

comment on function working_days(date, date) is
  'Elapsed days from from_date to to_date, excluding Sundays. The studio''s '
  'working week is six days, so this is the only day count the app shows.';

-- A planned duration is quoted in weeks and must be compared against a working
-- day count, not a calendar one, or every substage would look late by a day a
-- week. Six working days to the week.
create or replace function planned_working_days(weeks numeric)
returns int as $$
  select case when weeks is null then null else round(weeks * 6)::int end;
$$ language sql immutable;

comment on function planned_working_days(numeric) is
  'A planned duration in weeks, expressed in working days (6 per week) so it is '
  'comparable with working_days().';

revoke all on function working_days(date, date) from public, anon;
revoke all on function planned_working_days(numeric) from public, anon;
grant execute on function working_days(date, date) to authenticated;
grant execute on function planned_working_days(numeric) to authenticated;

insert into schema_migrations (version) values ('0008_working_days')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0009_sections_and_delivery.sql
-- ############################################################################

-- 0009_sections_and_delivery.sql
--
-- Two dates the studio asked to be able to set, and one thing it asked to stop
-- seeing.
--
-- 1. A deadline per SECTION. The project screen is read by stage group -
--    "concept development", "GFC - architecture" - and that is the level a
--    principal commits to a client at. Until now the only authorable date was
--    project_substage.target_date, one per substage, which is a finer grain than
--    anyone actually promises anything at.
--
--    This does not violate CLAUDE.md rule 2. That rule governs started_on and
--    concluded_on, which are records of what happened and stay stamped by the
--    trigger. A deadline is a plan, not a record, and a plan has to be typed by
--    a person because nothing else knows it. Same reasoning as migration 0004.
--
-- 2. An expected delivery date per PROJECT, captured when the project is created.
--
-- 3. Blocks. "Blocked by" is removed from the product. The table and its rows
--    are deliberately NOT dropped: it holds real history, dropping it is
--    irreversible, and nothing in the app reads it after migration 0012. If the
--    studio is sure, `drop table blocks` is a one-line follow-up; it is not
--    something this migration should decide on its behalf.

begin;

-- ------------------------------------------------------------------ sections
create table if not exists project_stage_group (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage_group_id uuid not null references stage_groups(id),
  target_date date,
  unique (project_id, stage_group_id)
);

comment on table project_stage_group is
  'One row per project per section, holding the deadline the studio set for it. '
  'A row exists only once someone has set a date; absence means no deadline.';

create index if not exists project_stage_group_project_idx
  on project_stage_group (project_id);

alter table project_stage_group enable row level security;

drop policy if exists read_all  on project_stage_group;
drop policy if exists write_any on project_stage_group;
drop policy if exists edit_any  on project_stage_group;
drop policy if exists del_any   on project_stage_group;

create policy read_all  on project_stage_group for select to authenticated using (true);
create policy write_any on project_stage_group for insert to authenticated with check (true);
create policy edit_any  on project_stage_group for update to authenticated using (true) with check (true);
-- Clearing a deadline is removing a plan, not losing history, so a delete is
-- allowed here for the same reason it is on assignments.
create policy del_any   on project_stage_group for delete to authenticated using (true);

-- ------------------------------------------------------------------ delivery
alter table projects add column if not exists target_delivery date;

comment on column projects.target_delivery is
  'When the project is expected to be delivered. Set on the new-project form and '
  'editable afterwards. A plan, so a person types it; see 0004.';

insert into schema_migrations (version) values ('0009_sections_and_delivery')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0010_taxonomy.sql
-- ############################################################################

-- 0010_taxonomy.sql
--
-- Brings the substage taxonomy in line with the section list the studio wrote
-- out. Most of that list already existed verbatim - concept development, design
-- development, foundation, elevation, GFC-architecture and GFC-ID all matched
-- what migration 0001 and the seed already carried. Two things did not:
--
--   a. Two group names were the spreadsheet's abbreviations rather than words.
--      Renaming a stage group is safe at any time: nothing references it by
--      name except this file, and no project data is attached to the name.
--
--   b. ID-DESIGN DEVELOPMENT was listed as
--        mood board, civil drawings, component drawings & coordination,
--        material selection, services drawing
--      and held only the first of those plus two others.
--
--      The four missing ones are ADDED. The two the list did not mention -
--      SPACE OPTIMZATION IN CIVIL and INTERIOR PROPOSAL - are left active and
--      untouched: eight projects already carry rows against them, CLAUDE.md
--      rule 3 forbids deleting a substage, and archiving one that has project
--      data is a decision for the studio, made in the knowledge that it hides
--      history. Set active = false on those two if that is what is wanted.
--
-- Everything here is matched by name, never by id: seed.sql generates fresh
-- UUIDs on every run, so the ids in the repository are not the ids in the
-- database. Everything here is also idempotent and can be re-run.

begin;

update stage_groups set name = 'FOUNDATION DRAWINGS' where name = 'FOUNDATION DWGS';
update stage_groups set name = 'ELEVATION DESIGN'    where name = 'ELEVATION DESIGNING';

insert into substages (stage_group_id, name, seq, planned_weeks, active)
select g.id, v.name, v.seq, v.weeks, true
from stage_groups g
cross join (values
  ('CIVIL DRAWINGS',                    21, null::numeric),
  ('COMPONENT DRAWINGS & COORDINATION', 22, null),
  ('MATERIAL SELECTION',                23, null),
  ('SERVICES DRAWING',                  24, null)
) as v(name, seq, weeks)
where g.name = 'ID-DESIGN DEVELOPMENT'
  and not exists (
    select 1 from substages s
    where s.stage_group_id = g.id and s.name = v.name
  );

insert into schema_migrations (version) values ('0010_taxonomy')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0011_project_structure.sql
-- ############################################################################

-- 0011_project_structure.sql
--
-- Gives a project the full section structure, so the project screen reads the
-- same way for all of them instead of being empty for 20 of 37.
--
-- WHY THIS IS A FUNCTION AND NOT A ONE-OFF INSERT
--
-- The same rule is needed in three places: backfilling the projects that exist
-- today, creating a project in the browser, and loading a fresh database where
-- the seed runs after this file. Written as an insert it would have to be
-- correct in three dialects and stay correct in all three. Written once, the
-- browser calls it by RPC and gets identical rows to the backfill below.
--
-- WHAT IT CHANGES, STATED PLAINLY
--
-- Before this, 20 projects had no project_substage rows and the board reported
-- them as "No stages tracked". That number was a finding, not a bug (CLAUDE.md,
-- "show the gaps"), and this does not delete the finding - it moves it. A
-- project whose stages all sit at not_started is still visibly untouched; the
-- board now says "Not started" and counts it on the "Not started" card. The gap
-- is still on screen, as a gap inside a structure rather than the absence of one.
--
-- SCOPE IS A DECISION, MADE EXPLICITLY
--
-- Inserting all 25 substages for every project would claim interior GFC is in
-- scope for every architecture job, which is not true and is not something a
-- migration is entitled to assert. The status enum has the right word already:
--
--   AR projects   architecture sections not_started, interior sections not_in_scope
--   ID and IR     interior sections not_started, architecture sections not_in_scope
--
-- A default, not a verdict. Every row is one dropdown away from correction, and
-- correcting it writes an event like any other change.
--
-- NOTHING EXISTING IS TOUCHED. `on conflict do nothing` means a project that
-- already has a row for a substage keeps it, with its status, its stamped dates
-- and its history. This can only add, and it is safe to re-run.
--
-- No events are written: stamp_and_log() fires on UPDATE and this is an INSERT,
-- so the audit log stays a record of what people did.

begin;

create or replace function ensure_project_structure(p_project_id uuid)
returns int as $$
  with inserted as (
    insert into project_substage (project_id, substage_id, status)
    select
      p.id,
      s.id,
      case
        when sg.name in ('CONCEPT DEVELOPMENT', 'DESIGN DEVELOPMENT',
                         'FOUNDATION DRAWINGS', 'ELEVATION DESIGN',
                         'GFC - ARCHITECTURE')
          then case when p.type = 'AR' then 'not_started' else 'not_in_scope' end
        else
          case when p.type = 'AR' then 'not_in_scope' else 'not_started' end
      end
    from projects p
    cross join substages s
    join stage_groups sg on sg.id = s.stage_group_id
    where p.id = p_project_id
      and s.active and sg.active
    on conflict (project_id, substage_id) do nothing
    returning 1
  )
  select count(*)::int from inserted;
$$ language sql volatile;

comment on function ensure_project_structure(uuid) is
  'Adds any missing project_substage rows for one project, scoping interior vs '
  'architecture sections by project type. Never modifies an existing row. Safe '
  'to re-run. Called by the new-project form and by the backfill in 0011.';

revoke all on function ensure_project_structure(uuid) from public, anon;
grant execute on function ensure_project_structure(uuid) to authenticated;

-- The backfill. A no-op on an empty database, where the seed has not run yet;
-- the seed calls the same function at the end of its own load.
select ensure_project_structure(id)
from projects
where status not in ('cancelled', 'completed');

insert into schema_migrations (version) values ('0011_project_structure')
  on conflict (version) do nothing;

commit;

-- ############################################################################
-- ## 0012_board_view.sql
-- ############################################################################

-- 0012_board_view.sql
--
-- Rebuilds v_board on top of the three changes above. Four differences from 0005:
--
-- 1. EVERY DAY COUNT EXCLUDES SUNDAYS. days_in_substage and days_over now come
--    from working_days(), and a planned duration in weeks is converted at six
--    working days to the week rather than seven. Comparing a six-day elapsed
--    count against a seven-day plan would have made everything look a day a week
--    early, which is a worse lie than the one it replaces.
--
-- 2. blocked_by IS GONE. Removed from the product at the studio's request. The
--    blocks table still exists and still holds its rows; nothing reads them.
--
-- 3. A THIRD LATENESS SIGNAL: days_past_section, from the section deadline added
--    in 0009. The board ranks a project's several in-process substages by, in
--    order, how far each is past its planned duration, then past its own target
--    date, then past its section deadline, then stage order. The ranking is
--    unchanged in spirit: the row shows the substage that is stuck.
--
-- 4. NEW COUNTS, because 0011 gave every project a full structure and the old
--    counts would have gone flat.
--      substage_count   every row, in scope or not      (unchanged meaning)
--      in_scope_count   rows the studio says apply here
--      started_count    rows anyone has actually begun
--    "No stages tracked" was true of 20 projects before 0011 and of none after,
--    so started_count is what now carries that signal: a project with a full
--    structure and nothing begun is untouched work, and the board says so.
--    substage_count = 0 is still possible (a cancelled or completed project 0011
--    skipped) and still reads as "No stages tracked".

begin;

drop view if exists v_board;

create view v_board as
with section_target as (
  select psg.project_id, s.id as substage_id, psg.target_date
  from project_stage_group psg
  join substages s on s.stage_group_id = psg.stage_group_id
),
active as (
  select
    ps.project_id,
    ps.substage_id,
    ps.started_on,
    ps.target_date,
    st.target_date as section_target,
    s.name        as substage_name,
    s.planned_weeks,
    sg.name       as stage_group_name,
    sg.seq        as group_seq,
    s.seq         as substage_seq,
    working_days(ps.started_on, current_date)          as days_in_substage,
    working_days(ps.started_on, current_date)
      - planned_working_days(s.planned_weeks)          as days_over,
    working_days(ps.target_date, current_date)         as days_past_target,
    working_days(st.target_date, current_date)         as days_past_section
  from project_substage ps
  join substages s     on s.id  = ps.substage_id
  join stage_groups sg on sg.id = s.stage_group_id
  left join section_target st
         on st.project_id = ps.project_id and st.substage_id = ps.substage_id
  where ps.status = 'in_process'
),
worst as (
  select distinct on (project_id)
    project_id, substage_id, substage_name, stage_group_name,
    planned_weeks, started_on, target_date, section_target,
    days_in_substage, days_over, days_past_target, days_past_section,
    count(*) over (partition by project_id) as active_substage_count
  from active
  order by
    project_id,
    days_over        desc nulls last,
    days_past_target desc nulls last,
    days_past_section desc nulls last,
    group_seq, substage_seq
)
select
  p.id, p.name, p.code, p.type, p.status, p.priority, p.client_name,
  p.target_delivery,
  working_days(current_date, p.target_delivery) as days_to_delivery,
  w.substage_name,
  w.stage_group_name,
  w.planned_weeks,
  planned_working_days(w.planned_weeks) as planned_days,
  w.started_on,
  w.target_date,
  w.section_target,
  w.days_in_substage,
  w.days_over,
  w.days_past_target,
  w.days_past_section,
  coalesce(w.active_substage_count, 0) as active_substage_count,
  (select count(*) from project_substage ps2
    where ps2.project_id = p.id) as substage_count,
  (select count(*) from project_substage ps2
    where ps2.project_id = p.id and ps2.status <> 'not_in_scope') as in_scope_count,
  (select count(*) from project_substage ps2
    where ps2.project_id = p.id and ps2.status = 'done') as done_count,
  (select count(*) from project_substage ps2
    where ps2.project_id = p.id
      and (ps2.started_on is not null or ps2.status in ('in_process', 'done'))) as started_count
from projects p
left join worst w on w.project_id = p.id;

revoke all on v_board from anon;
grant select on v_board to authenticated;

insert into schema_migrations (version) values ('0012_board_view')
  on conflict (version) do nothing;

commit;
