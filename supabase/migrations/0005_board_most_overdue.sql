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
