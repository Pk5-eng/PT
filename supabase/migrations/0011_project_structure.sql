-- 0011_project_structure.sql
--
-- Gives a project the full section structure, so the project screen reads the
-- same way for all of them instead of being empty for 20 of 37.
--
-- WHY THIS IS A FUNCTION AND NOT A ONE-OFF INSERT
--
-- The same rule is needed in three places: backfilling the projects that exist
-- today, creating a project in the browser, and loading a fresh database where
-- the seed runs after this file. Written as an insert it would have to be
-- correct in three dialects and stay correct in all three. Written once, the
-- browser calls it by RPC and gets identical rows to the backfill below.
--
-- WHAT IT CHANGES, STATED PLAINLY
--
-- Before this, 20 projects had no project_substage rows and the board reported
-- them as "No stages tracked". That number was a finding, not a bug (CLAUDE.md,
-- "show the gaps"), and this does not delete the finding - it moves it. A
-- project whose stages all sit at not_started is still visibly untouched; the
-- board now says "Not started" and counts it on the "Not started" card. The gap
-- is still on screen, as a gap inside a structure rather than the absence of one.
--
-- SCOPE IS A DECISION, MADE EXPLICITLY
--
-- Inserting all 25 substages for every project would claim interior GFC is in
-- scope for every architecture job, which is not true and is not something a
-- migration is entitled to assert. The status enum has the right word already:
--
--   AR projects   architecture sections not_started, interior sections not_in_scope
--   ID and IR     interior sections not_started, architecture sections not_in_scope
--
-- A default, not a verdict. Every row is one dropdown away from correction, and
-- correcting it writes an event like any other change.
--
-- NOTHING EXISTING IS TOUCHED. `on conflict do nothing` means a project that
-- already has a row for a substage keeps it, with its status, its stamped dates
-- and its history. This can only add, and it is safe to re-run.
--
-- No events are written: stamp_and_log() fires on UPDATE and this is an INSERT,
-- so the audit log stays a record of what people did.

begin;

create or replace function ensure_project_structure(p_project_id uuid)
returns int as $$
  with inserted as (
    insert into project_substage (project_id, substage_id, status)
    select
      p.id,
      s.id,
      case
        when sg.name in ('CONCEPT DEVELOPMENT', 'DESIGN DEVELOPMENT',
                         'FOUNDATION DRAWINGS', 'ELEVATION DESIGN',
                         'GFC - ARCHITECTURE')
          then case when p.type = 'AR' then 'not_started' else 'not_in_scope' end
        else
          case when p.type = 'AR' then 'not_in_scope' else 'not_started' end
      end
    from projects p
    cross join substages s
    join stage_groups sg on sg.id = s.stage_group_id
    where p.id = p_project_id
      and s.active and sg.active
    on conflict (project_id, substage_id) do nothing
    returning 1
  )
  select count(*)::int from inserted;
$$ language sql volatile;

comment on function ensure_project_structure(uuid) is
  'Adds any missing project_substage rows for one project, scoping interior vs '
  'architecture sections by project type. Never modifies an existing row. Safe '
  'to re-run. Called by the new-project form and by the backfill in 0011.';

revoke all on function ensure_project_structure(uuid) from public, anon;
grant execute on function ensure_project_structure(uuid) to authenticated;

-- The backfill. A no-op on an empty database, where the seed has not run yet;
-- the seed calls the same function at the end of its own load.
select ensure_project_structure(id)
from projects
where status not in ('cancelled', 'completed');

insert into schema_migrations (version) values ('0011_project_structure')
  on conflict (version) do nothing;

commit;
