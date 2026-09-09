-- 0002_trigger_and_view.sql
-- The stamping trigger and the board view, verbatim from spec section 3.
--
-- The trigger is the reason users never type a date. It fires only on UPDATE,
-- which is correct for the app (rows are created 'not_started' and moved by the
-- dropdown) but means the seed script must set started_on / concluded_on itself
-- on INSERT. See scripts/seed.mjs.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

create or replace function stamp_and_log() returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_process' and new.started_on is null then
      new.started_on := current_date;
    end if;
    if new.status = 'done' and new.concluded_on is null then
      new.concluded_on := current_date;
    end if;
    if new.status <> 'done' then
      new.concluded_on := null;
    end if;
    insert into events (project_id, substage_id, actor_id, from_status, to_status)
    values (new.project_id, new.substage_id,
            (select id from people where auth_id = auth.uid()),
            old.status, new.status);
  end if;
  return new;
end $$ language plpgsql security definer;

drop trigger if exists trg_stamp_and_log on project_substage;

create trigger trg_stamp_and_log
  before update on project_substage
  for each row execute function stamp_and_log();

-- Dropped rather than replaced: `create or replace view` cannot change a
-- view's column list, and migration 0012 gives v_board a different one. On a
-- re-run this would otherwise fail here, before reaching the migration that
-- defines the shape actually wanted.
drop view if exists v_board;

create view v_board as
with current_sub as (
  select distinct on (ps.project_id)
    ps.project_id, ps.substage_id, ps.status, ps.started_on,
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
  case when c.started_on is null then null
       else current_date - c.started_on end as days_in_substage,
  case when c.started_on is null or c.planned_weeks is null then null
       else (current_date - c.started_on) - round(c.planned_weeks * 7) end as days_over,
  (select b.owner from blocks b
    where b.project_id = p.id and b.cleared_on is null
    order by b.raised_on limit 1) as blocked_by
from projects p
left join current_sub c on c.project_id = p.id;

insert into schema_migrations (version) values ('0002_trigger_and_view')
  on conflict (version) do nothing;

commit;
