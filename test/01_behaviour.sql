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
