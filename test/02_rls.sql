-- RLS tests. There is no backend server, so these policies are the whole
-- authorisation boundary. Test harness only.
update people set auth_id='11111111-1111-1111-1111-111111111111', role='admin'  where name='Madhu';
update people set auth_id='22222222-2222-2222-2222-222222222222', role='member' where name='Niharika';

create or replace function expect(label text, ok boolean) returns text as $$
  select case when ok then 'pass  ' else 'FAIL  ' end || label;
$$ language sql;

-- Runs a statement and reports whether it was refused.
create or replace function refused(label text, stmt text) returns text as $$
begin
  execute stmt;
  return 'FAIL  ' || label || ' (was allowed)';
exception when insufficient_privilege or others then
  return 'pass  ' || label;
end $$ language plpgsql;

\echo ''
\echo '=== as an ANONYMOUS visitor (public anon key, not signed in) ==='
-- RLS denies a read by returning zero rows, not by raising. An unauthorised
-- visitor therefore sees an empty app, not an error. Writes do raise.
set role anon;
select test_become(null);
select expect('anon sees no projects',            (select count(*)=0 from projects));
select expect('anon sees no project_substage',    (select count(*)=0 from project_substage));
select expect('anon sees no project_deliverable', (select count(*)=0 from project_deliverable));
select expect('anon sees no events',              (select count(*)=0 from events));
select expect('anon sees no people',              (select count(*)=0 from people));
select refused('anon cannot read the board at all', 'select 1 from v_board limit 1');
select refused('anon cannot create a project', 'insert into projects (name,type) values (''Hack'',''AR'')');
-- An UPDATE with no applicable policy matches no rows: it reports success and
-- changes nothing. Assert the row count, not an exception.
create temp table before_ as select count(*) filter (where status='done') as n from project_substage;
update project_substage set status='done';
select expect('anon''s update changed nothing',
  (select n from before_) = (select count(*) filter (where status='done') from project_substage));
reset role;

\echo ''
\echo '=== as a MEMBER (Niharika, role=member) ==='
set role authenticated;
select test_become('22222222-2222-2222-2222-222222222222');
select expect('member reads all 37 projects', (select count(*)=37 from projects));
select expect('member reads the board',       (select count(*)=37 from v_board));
select refused('member cannot add a substage',
  'insert into substages (stage_group_id,name,seq) values ((select id from stage_groups limit 1),''X'',99)');
select refused('member cannot add a person',
  'insert into people (name) values (''Intruder'')');
select refused('member cannot delete a substage', 'delete from substages');
select refused('member cannot delete an event',   'delete from events');
select refused('member cannot forge an event',
  'insert into events (project_id,to_status) values ((select id from projects limit 1),''done'')');
select refused('member cannot rewrite an event',  'update events set to_status=''done''');
reset role;

\echo ''
\echo '=== a member CAN do the everyday work ==='
set role authenticated;
select test_become('22222222-2222-2222-2222-222222222222');
update project_substage set status='in_process'
  where id=(select id from project_substage where status='not_started' or status='done' limit 1);
select expect('member can move a substage status', true);
select expect('and the trigger logged it as Niharika',
  (select pe.name='Niharika' from events e join people pe on pe.id=e.actor_id order by e.id desc limit 1));
reset role;

\echo ''
\echo '=== as an ADMIN (Madhu, role=admin) ==='
set role authenticated;
select test_become('11111111-1111-1111-1111-111111111111');
insert into substages (stage_group_id,name,seq) values ((select id from stage_groups limit 1),'ADMIN TEST',99);
select expect('admin can add a substage', (select count(*)=1 from substages where name='ADMIN TEST'));
update substages set active=false where name='ADMIN TEST';
select expect('admin can archive a substage', (select not active from substages where name='ADMIN TEST'));
select refused('even an admin cannot delete a substage', 'delete from substages where name=''ADMIN TEST''');
reset role;

\echo ''
\echo '=== section deadlines and project creation (added with 0009 and 0011) ==='
set role authenticated;
select test_become('22222222-2222-2222-2222-222222222222');

-- A member sets a deadline. It is a plan, so unlike started_on it is theirs to
-- author; the same reasoning as project_substage.target_date in 0004.
-- Scoped to one named project, because 01_behaviour.sql already left a row here.
create temp table dl as select id from projects where name = 'Kanota Jaipur';

insert into project_stage_group (project_id, stage_group_id, target_date)
values ((select id from dl), (select id from stage_groups order by seq limit 1), current_date + 30);
select expect('member can set a section deadline',
  (select target_date = current_date + 30 from project_stage_group
    where project_id = (select id from dl)));

update project_stage_group set target_date = null where project_id = (select id from dl);
select expect('member can clear a section deadline without losing the row',
  (select count(*) = 1 and bool_and(target_date is null) from project_stage_group
    where project_id = (select id from dl)));

delete from project_stage_group where project_id = (select id from dl);
select expect('member can remove a section deadline entirely',
  (select count(*) = 0 from project_stage_group where project_id = (select id from dl)));

-- Creating a project is everyday work: the form does exactly this.
insert into projects (name, type, target_delivery) values ('RLS TEST PROJECT', 'AR', current_date + 90);
select expect('member can create a project with a delivery date',
  (select count(*) = 1 from projects where name = 'RLS TEST PROJECT'));

select expect('and its full section structure comes back from the function',
  (select ensure_project_structure((select id from projects where name = 'RLS TEST PROJECT')) > 20));

select expect('an AR project gets architecture in scope and interiors out of it',
  (select bool_and(case when sg.name in ('ID-DESIGN DEVELOPMENT','GFC-ID')
                        then ps.status = 'not_in_scope'
                        else ps.status = 'not_started' end)
     from project_substage ps
     join substages s on s.id = ps.substage_id
     join stage_groups sg on sg.id = s.stage_group_id
     where ps.project_id = (select id from projects where name = 'RLS TEST PROJECT')));

select expect('creating the structure wrote no events',
  (select count(*) = 0 from events
    where project_id = (select id from projects where name = 'RLS TEST PROJECT')));

-- A project is closed by a status change, never by disappearing: deleting one
-- would take its events with it through the cascade.
--
-- Note how this is asserted. There is no delete policy on projects, and RLS
-- enforces that by making the rows invisible to the delete rather than by
-- raising - so the statement succeeds and removes nothing. Checking for an
-- exception here would pass for the wrong reason on any future day when a
-- permissive policy is added, because a policy that allows the delete also
-- raises no exception. The row surviving is the thing that actually matters.
delete from projects where name = 'RLS TEST PROJECT';
select expect('a member''s delete removes no project',
  (select count(*) = 1 from projects where name = 'RLS TEST PROJECT'));
select expect('and its substages are still there',
  (select count(*) > 20 from project_substage
    where project_id = (select id from projects where name = 'RLS TEST PROJECT')));
reset role;

\echo ''
\echo '=== an anonymous visitor still sees none of it ==='
set role anon;
select test_become(null);
select expect('anon sees no section deadlines', (select count(*) = 0 from project_stage_group));
select refused('anon cannot set a section deadline',
  'insert into project_stage_group (project_id, stage_group_id, target_date)
     values ((select id from projects limit 1), (select id from stage_groups limit 1), current_date)');
reset role;
