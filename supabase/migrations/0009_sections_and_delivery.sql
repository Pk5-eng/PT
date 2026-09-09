-- 0009_sections_and_delivery.sql
--
-- Two dates the studio asked to be able to set, and one thing it asked to stop
-- seeing.
--
-- 1. A deadline per SECTION. The project screen is read by stage group -
--    "concept development", "GFC - architecture" - and that is the level a
--    principal commits to a client at. Until now the only authorable date was
--    project_substage.target_date, one per substage, which is a finer grain than
--    anyone actually promises anything at.
--
--    This does not violate CLAUDE.md rule 2. That rule governs started_on and
--    concluded_on, which are records of what happened and stay stamped by the
--    trigger. A deadline is a plan, not a record, and a plan has to be typed by
--    a person because nothing else knows it. Same reasoning as migration 0004.
--
-- 2. An expected delivery date per PROJECT, captured when the project is created.
--
-- 3. Blocks. "Blocked by" is removed from the product. The table and its rows
--    are deliberately NOT dropped: it holds real history, dropping it is
--    irreversible, and nothing in the app reads it after migration 0012. If the
--    studio is sure, `drop table blocks` is a one-line follow-up; it is not
--    something this migration should decide on its behalf.

begin;

-- ------------------------------------------------------------------ sections
create table if not exists project_stage_group (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stage_group_id uuid not null references stage_groups(id),
  target_date date,
  unique (project_id, stage_group_id)
);

comment on table project_stage_group is
  'One row per project per section, holding the deadline the studio set for it. '
  'A row exists only once someone has set a date; absence means no deadline.';

create index if not exists project_stage_group_project_idx
  on project_stage_group (project_id);

alter table project_stage_group enable row level security;

drop policy if exists read_all  on project_stage_group;
drop policy if exists write_any on project_stage_group;
drop policy if exists edit_any  on project_stage_group;
drop policy if exists del_any   on project_stage_group;

create policy read_all  on project_stage_group for select to authenticated using (true);
create policy write_any on project_stage_group for insert to authenticated with check (true);
create policy edit_any  on project_stage_group for update to authenticated using (true) with check (true);
-- Clearing a deadline is removing a plan, not losing history, so a delete is
-- allowed here for the same reason it is on assignments.
create policy del_any   on project_stage_group for delete to authenticated using (true);

-- ------------------------------------------------------------------ delivery
alter table projects add column if not exists target_delivery date;

comment on column projects.target_delivery is
  'When the project is expected to be delivered. Set on the new-project form and '
  'editable afterwards. A plan, so a person types it; see 0004.';

insert into schema_migrations (version) values ('0009_sections_and_delivery')
  on conflict (version) do nothing;

commit;
