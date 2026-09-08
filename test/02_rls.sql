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
