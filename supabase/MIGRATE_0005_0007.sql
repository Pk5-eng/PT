-- ============================================================================
-- INCREMENTAL MIGRATION: 0005, 0006, 0007
--
-- Apply this if you have already run ALL_MIGRATIONS.sql (0001-0004).
-- Do NOT re-run ALL_MIGRATIONS.sql - 0001 would fail on existing tables.
--
-- SAFE TO RUN TWICE. Every statement here is idempotent, so it does not
-- matter whether you already applied 0005 and 0006 earlier.
--
--   0005  v_board shows a project's MOST OVERDUE substage instead of its
--         earliest, and counts the others ("+6 more"). Also distinguishes a
--         finished project from one with no stage data.
--   0006  link_my_identity(), so a signed-in user claims their own row in
--         people and the activity feed can say who changed what.
--   0007  stamps project_deliverable.done_on when a deliverable is ticked,
--         and clears it when unticked. Dates are never typed.
-- ============================================================================


-- ## 0005_board_most_overdue.sql

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

commit;

-- ## 0006_link_identity.sql

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

commit;

-- ## 0007_deliverable_stamp.sql

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

commit;
