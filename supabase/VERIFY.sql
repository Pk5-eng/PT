-- VERIFY.sql
--
-- Paste into the Supabase SQL editor after ALL_MIGRATIONS.sql. It writes
-- nothing. It answers two questions, in this order:
--
--   1. IS THIS DATABASE CURRENT?  The first result set. If the verdict is not
--      READY, paste ALL_MIGRATIONS.sql and run this again.
--   2. Does the seeded data still reconcile with seed.json? The second.
--
-- DRIFT: four checks in the second set marked (drift) describe the database on
-- the day it was seeded, not forever. Every status moved inside the app changes
-- them, and that is the tool working. Run this before the studio starts using
-- it; after that, only the checks not marked (drift) still mean anything.

-- ---------------------------------------------------------------------------
-- 1. Is this database current?
--
-- Counted from the catalogue rather than read off schema_migrations, so a
-- ledger row written by a migration that was later rolled back or hand-edited
-- cannot make a broken database claim to be fine.
-- ---------------------------------------------------------------------------
with need as (
  select
    (select count(*) from information_schema.tables where table_schema='public'
      and table_name in ('people','projects','stage_groups','substages','deliverables',
                         'project_substage','project_deliverable','assignments','blocks',
                         'events','project_stage_group','schema_migrations')) as tables,
    (select count(*) from information_schema.columns where table_name='v_board'
      and column_name in ('target_delivery','days_to_delivery','section_target',
                          'days_past_section','in_scope_count','started_count','planned_days')) as board_columns,
    (select count(*) from pg_proc where proname in
      ('stamp_and_log','is_admin','link_my_identity','stamp_deliverable',
       'working_days','planned_working_days','ensure_project_structure')) as functions,
    (select coalesce(max(version), 'none') from schema_migrations) as at
)
select
  at                          as "schema at",
  tables || ' / 12'           as "tables",
  board_columns || ' / 7'     as "board columns",
  functions || ' / 7'         as "functions",
  case when tables = 12 and board_columns = 7 and functions = 7
       then 'READY'
       else 'BEHIND - paste supabase/ALL_MIGRATIONS.sql and run this again'
  end                         as "verdict"
from need;

-- ---------------------------------------------------------------------------
-- 2. Does the seeded data still reconcile with seed.json?
--
-- The expected figures come from `npm run seed:dry`, which is the same
-- transform that produced the insert. If a number here disagrees with that
-- output, this file is stale, not the database.
-- ---------------------------------------------------------------------------
with counts as (
  select
    (select count(*) from people)                                        as people,
    (select count(*) from stage_groups)                                  as stage_groups,
    (select count(*) from substages)                                     as substages,
    (select count(*) from deliverables)                                  as deliverables,
    (select count(*) from projects)                                      as projects,
    (select count(*) from assignments)                                   as assignments,
    (select count(*) from project_substage)                              as project_substage,
    (select count(*) from project_substage where status = 'done')        as ps_done,
    (select count(*) from project_substage where status = 'in_process')  as ps_in_process,
    (select count(*) from project_substage where status = 'hold')        as ps_hold,
    (select count(*) from project_substage where status = 'cancelled')   as ps_cancelled,
    (select count(*) from project_substage where started_on is not null) as ps_started,
    (select count(*) from project_substage where target_date is not null) as ps_target,
    (select count(*) from substages where planned_weeks is not null)     as sub_planned,
    (select count(*) from projects p
      where not exists (select 1 from project_substage ps where ps.project_id = p.id)) as proj_no_stage,
    (select count(*) from assignments a join people pe on pe.id = a.person_id
      where pe.name = 'Madhu' and a.role_code <> 'INVOLVED')             as madhu,
    (select count(*) from assignments a join people pe on pe.id = a.person_id
      where pe.name = 'Selva' and a.role_code <> 'INVOLVED')             as selva,
    (select count(*) from substages where name like 'MATERIAL SELECTION - ROUND%') as rounds
),
checks(seq, check_name, expected, actual) as (
  select  1, 'people',                                9, people            from counts
  union all select  2, 'stage groups',                7, stage_groups      from counts
  union all select  3, 'substages',                  25, substages         from counts
  union all select  4, 'deliverables',               58, deliverables      from counts
  union all select  5, 'projects',                   37, projects          from counts
  union all select  6, 'assignments',                70, assignments       from counts
  union all select  7, 'project_substage rows',     925, project_substage  from counts
  union all select  8, 'status done (drift)',       107, ps_done           from counts
  union all select  9, 'status in_process (drift)',  42, ps_in_process     from counts
  union all select 10, 'status hold (drift)',         1, ps_hold           from counts
  union all select 11, 'status cancelled (drift)',    1, ps_cancelled      from counts
  union all select 12, 'rows with started_on (drift)', 0, ps_started       from counts
  union all select 13, 'rows with target_date',        5, ps_target        from counts
  union all select 14, 'substages with planned_weeks', 8, sub_planned      from counts
  union all select 15, 'projects with no stage data',   0, proj_no_stage   from counts
  union all select 16, 'Madhu, excluding INVOLVED',    14, madhu           from counts
  union all select 17, 'Selva, excluding INVOLVED',     7, selva           from counts
  union all select 18, 'MATERIAL SELECTION rounds',     2, rounds          from counts
)
select
  check_name                                   as "check",
  expected,
  actual,
  case when expected = actual then 'PASS' else 'CHECK' end as verdict
from checks
order by seq;
