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

commit;
