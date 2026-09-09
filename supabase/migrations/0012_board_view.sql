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
