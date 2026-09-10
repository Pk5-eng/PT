-- Behaviour tests for the trigger and the board view. Test harness only.
\set ON_ERROR_STOP on

-- Give one person an auth identity so auth.uid() resolves to them.
update people set auth_id = '11111111-1111-1111-1111-111111111111', role = 'admin'
where name = 'Madhu';
select test_become('11111111-1111-1111-1111-111111111111');

\echo '--- v_board shape ---'
select count(*) as board_rows,
       count(substage_name) as with_current_substage,
       count(days_in_substage) as with_days,
       count(days_past_target) as with_target
from v_board;

\echo '--- projects showing as Not set (no in_process substage) ---'
select count(*) from v_board where substage_name is null;

\echo '--- board sorted by days_past_target, the only signal with data on day one ---'
select name, substage_name, days_past_target
from v_board where days_past_target is not null
order by days_past_target desc;

\echo '--- TRIGGER 1: not_started -> in_process stamps started_on ---'
create temp table t as
  select ps.id from project_substage ps
  join projects p on p.id = ps.project_id
  join substages s on s.id = ps.substage_id
  where p.name = 'Kanota Jaipur' and s.name = 'MASSING & ZONING CONCEPT';
update project_substage set status = 'not_started' where id in (select id from t);
update project_substage set status = 'in_process' where id in (select id from t);
select status, started_on = current_date as started_stamped, concluded_on
from project_substage where id in (select id from t);

\echo '--- TRIGGER 2: in_process -> done stamps concluded_on ---'
update project_substage set status = 'done' where id in (select id from t);
select status, concluded_on = current_date as concluded_stamped
from project_substage where id in (select id from t);

\echo '--- TRIGGER 3: done -> in_process clears concluded_on ---'
update project_substage set status = 'in_process' where id in (select id from t);
select status, concluded_on is null as concluded_cleared
from project_substage where id in (select id from t);

\echo '--- TRIGGER 4: every change wrote an event, attributed to Madhu ---'
select e.from_status, e.to_status, pe.name as actor
from events e left join people pe on pe.id = e.actor_id
where e.substage_id = (select substage_id from project_substage where id in (select id from t))
  and e.project_id = (select project_id from project_substage where id in (select id from t))
order by e.id;

\echo '--- TRIGGER 5: target_date survives a status change (concluded_on must not) ---'
create temp table t2 as
  select ps.id from project_substage ps
  join projects p on p.id = ps.project_id
  where p.name = 'Srujan Reddy' and ps.target_date is not null limit 1;
select target_date is not null as had_target from project_substage where id in (select id from t2);
update project_substage set status = 'done' where id in (select id from t2);
update project_substage set status = 'in_process' where id in (select id from t2);
select target_date is not null as target_survived, concluded_on is null as concluded_cleared
from project_substage where id in (select id from t2);

-- ===========================================================================
-- Added with the working-day change, the section deadlines and the structure
-- backfill. Everything below is new behaviour from migrations 0008-0012.
-- ===========================================================================

\echo '--- WORKING DAYS: the same cases test/js/workdays.test.mjs asserts in JS ---'
-- If these two suites ever disagree, the board and the analytics screen are
-- reporting different durations for the same work and one of them is lying.
select
  working_days('2026-09-07','2026-09-14') = 6   as mon_to_mon_is_six,
  working_days('2026-09-06','2026-09-13') = 6   as sun_to_sun_is_six,
  working_days('2026-09-05','2026-09-12') = 6   as sat_to_sat_is_six,
  working_days('2026-09-07','2026-10-05') = 24  as four_weeks_is_24,
  working_days('2026-09-07','2026-09-12') = 5   as within_one_week_loses_none,
  working_days('2026-09-12','2026-09-14') = 1   as over_one_sunday_loses_one,
  working_days('2026-09-07','2026-09-07') = 0   as same_day_is_zero,
  working_days('2026-09-14','2026-09-07') = -6  as backwards_is_negative,
  working_days('1999-12-20','1999-12-27') = 6   as before_the_anchor_still_right,
  working_days(null,'2026-09-14') is null       as null_in_null_out,
  planned_working_days(1.5) = 9                 as plan_is_six_days_a_week;

\echo '--- WORKING DAYS: a year loses 52 or 53 days, never more ---'
select 365 - working_days('2025-01-01','2026-01-01') as sundays_in_2025;

\echo '--- STRUCTURE: every live project carries the full section list ---'
select
  count(*) filter (where n = 0) as projects_with_no_structure,
  min(n) as fewest_rows, max(n) as most_rows
from (
  select p.id, count(ps.id) as n
  from projects p
  left join project_substage ps on ps.project_id = p.id
  where p.status not in ('cancelled','completed')
  group by p.id
) s;

\echo '--- STRUCTURE: scope follows discipline, and it is a default not a verdict ---'
select p.type,
       count(*) filter (where ps.status = 'not_in_scope') as marked_out_of_scope,
       count(*) filter (where ps.status <> 'not_in_scope') as in_scope
from projects p
join project_substage ps on ps.project_id = p.id
join substages s on s.id = ps.substage_id
join stage_groups sg on sg.id = s.stage_group_id
where sg.name in ('ID-DESIGN DEVELOPMENT','GFC-ID')
group by p.type order by p.type;

\echo '--- STRUCTURE: re-running the function adds nothing and changes nothing ---'
create temp table before_run as select id, status, started_on from project_substage;
select sum(ensure_project_structure(id)) as rows_added_on_second_run from projects;
select count(*) = 0 as nothing_was_modified
from project_substage ps join before_run b on b.id = ps.id
where ps.status is distinct from b.status or ps.started_on is distinct from b.started_on;

\echo '--- BOARD: days are working days, and a plan is six days to the week ---'
-- Take one substage, start it exactly two calendar weeks ago, and check the
-- view reports twelve days rather than fourteen.
create temp table t3 as
  select ps.id, ps.project_id from project_substage ps
  join substages s on s.id = ps.substage_id
  where s.planned_weeks = 3 limit 1;
update project_substage set status = 'in_process' where id in (select id from t3);
update project_substage set started_on = current_date - 14 where id in (select id from t3);
select days_in_substage = 12 as sundays_excluded,
       planned_days = 18     as plan_in_working_days
from v_board
where id = (select project_id from t3) and started_on = current_date - 14;

\echo '--- BOARD: blocked_by is gone, and the new columns are present ---'
select
  (select count(*) from information_schema.columns
    where table_name='v_board' and column_name='blocked_by') as blocked_by_columns,
  (select count(*) from information_schema.columns
    where table_name='v_board'
      and column_name in ('target_delivery','days_to_delivery','section_target',
                          'days_past_section','in_scope_count','started_count',
                          'planned_days')) as new_columns;

\echo '--- SECTION DEADLINE: a section deadline reaches the board as days_past_section ---'
insert into project_stage_group (project_id, stage_group_id, target_date)
select ps.project_id, s.stage_group_id, current_date - 10
from project_substage ps join substages s on s.id = ps.substage_id
where ps.id in (select id from t3)
on conflict (project_id, stage_group_id) do update set target_date = excluded.target_date;

select days_past_section, days_past_section = working_days(current_date - 10, current_date)
         as counted_in_working_days
from v_board where id = (select project_id from t3);

\echo '--- SECTION DEADLINE: clearing it sets null rather than deleting history ---'
update project_stage_group set target_date = null
where project_id = (select project_id from t3);
select count(*) = 1 as row_kept, bool_and(target_date is null) as date_cleared
from project_stage_group where project_id = (select project_id from t3);

-- ===========================================================================
-- RECONCILIATION WITH THE ORIGINAL SPREADSHEET
--
-- The three figures the analytics screen reports, computed here in SQL against
-- the loaded seed. test/js/spreadsheet.test.mjs asserts the same numbers from
-- seed.json using the app's own functions, so each figure is pinned at both
-- ends: if the decode moves, the JS suite fails; if a migration or a query
-- moves, this one does. Neither can drift quietly.
--
-- READ THE COUNTS BELOW AS SHAPES, NOT AS SEED-DAY FIGURES. The trigger tests
-- above have already moved a handful of rows on purpose, so the undated counts
-- here are three or four off what a freshly seeded database shows. The figures
-- that must be exact - team load, and how many dates the sheet carried - are
-- unaffected by those mutations, and those are the ones asserted rather than
-- printed.
-- ===========================================================================

\echo '--- TEAM LOAD: must match seed.json exactly, Gururaj Sir included ---'
-- Advisory involvement excluded. 15 of the principal's 16 rows are the sheet's
-- oversight marker; counting them would make him the busiest person here.
select pe.name, count(*) as live_projects
from assignments a
join people pe on pe.id = a.person_id
join projects p on p.id = a.project_id
where a.role_code <> 'INVOLVED' and pe.active and p.status = 'ongoing'
group by pe.name
order by live_projects desc, pe.name;

\echo '--- TEAM LOAD: the whole table as one verdict (this one is asserted) ---'
select case when array_agg(name || '=' || n order by n desc, name) =
            array['Madhu=14','Selva=7','Pavan=6','Vibhaas=5','Varun=4',
                  'Venugopal=4','Niharika=3','Gururaj Sir=1']
            then 'PASS' else 'FAIL' end as team_load_matches_the_spreadsheet
from (
  select pe.name, count(*) as n
  from assignments a
  join people pe on pe.id = a.person_id
  join projects p on p.id = a.project_id
  where a.role_code <> 'INVOLVED' and pe.active and p.status = 'ongoing'
  group by pe.name
) t;

\echo '--- DEADLINES: the sheet carried five forward-looking dates, and no more ---'
-- Asserted, not merely printed: five is the whole of what 151 rows of a live
-- practice had committed to.
-- Seven dates in 151 rows. Two sat on finished work and became concluded_on;
-- the other five were expectations and became target_date (0004, decision B4).
-- This is the whole reason dates are stamped rather than typed.
select
  (select count(*) from project_substage where target_date is not null)  as stage_targets,
  (select count(*) from project_stage_group where target_date is not null) as section_deadlines,
  (select count(*) from projects where target_delivery is not null)       as delivery_dates;
-- started_on is deliberately not counted here: the trigger tests above stamp a
-- few. That the sheet recorded none is asserted in test/js/spreadsheet.test.mjs,
-- against seed.json, where nothing has moved.

\echo '--- UNSCHEDULED: in scope, unfinished, and carrying no date anywhere ---'
-- Split the way the screen splits it. The first number is the one to act on:
-- work already running with nothing holding it to a date.
select
  count(*) filter (where ps.status in ('in_process','hold'))  as running_undated,
  count(*) filter (where ps.status = 'not_started')           as not_started_undated,
  count(*)                                                    as total_undated
from project_substage ps
left join substages s   on s.id = ps.substage_id
left join project_stage_group psg
       on psg.project_id = ps.project_id and psg.stage_group_id = s.stage_group_id
where ps.status in ('not_started','in_process','hold')
  and ps.target_date is null
  and psg.target_date is null;

\echo '--- UNSCHEDULED: a date on the stage or on its section takes it off the list ---'
select
  (select count(*) from project_substage
    where status in ('not_started','in_process','hold') and target_date is not null)
    as excluded_by_their_own_date;
