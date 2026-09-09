-- ============================================================================
-- INCREMENTAL MIGRATION: 0008, 0009, 0010, 0011, 0012
--
-- Apply this if you have already run ALL_MIGRATIONS.sql (0001-0004) and
-- MIGRATE_0005_0007.sql. Do NOT re-run ALL_MIGRATIONS.sql - 0001 would fail on
-- the existing tables and everything after it would never run.
--
-- SAFE TO RUN TWICE. Every statement here is idempotent.
--
-- SAFE TO RUN BEFORE THE NEW FRONTEND IS DEPLOYED. Nothing here removes a
-- column the currently deployed app reads, except v_board.blocked_by, which the
-- old board shows as an empty cell rather than failing on. Apply this first,
-- then deploy.
--
--   0008  working_days() and planned_working_days(). Sundays are not days of
--         work, so no duration anywhere in the app counts them, and a plan
--         quoted in weeks is read as six working days to the week.
--   0009  project_stage_group, holding one deadline per section per project,
--         and projects.target_delivery. Both are plans rather than records,
--         which is why a person is allowed to type them.
--   0010  Adds the four missing ID-DESIGN DEVELOPMENT substages and spells out
--         two stage group names. Nothing is deleted or archived.
--   0011  ensure_project_structure(), the single definition of which sections a
--         project gets, and the backfill that gives every existing project the
--         full list. Adds only; never modifies a row that already exists, and
--         writes no events.
--   0012  Rebuilds v_board on all of the above. Day counts exclude Sundays,
--         blocked_by is gone, and the section deadline becomes a third
--         lateness signal.
--
-- AFTER RUNNING, this should return 0:
--
--   select count(*) from projects p
--   where p.status not in ('cancelled','completed')
--     and not exists (select 1 from project_substage ps where ps.project_id = p.id);
-- ============================================================================


-- ## 0008_working_days.sql

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

commit;

-- ## 0009_sections_and_delivery.sql

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

commit;

-- ## 0010_taxonomy.sql

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

commit;

-- ## 0011_project_structure.sql

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

commit;

-- ## 0012_board_view.sql

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

commit;
