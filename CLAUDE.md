# Kabra Architects Project Dashboard

Web application for a 10-person architecture practice in Bangalore. Replaces a spreadsheet
where project status was encoded as cell background colour.

Full specification: `KA_DASHBOARD_BUILD_SPEC.md`. Migration data: `seed.json`.

## Users

Nine studio members plus the principal. Non-technical. Primarily used at a desk, in a browser.
It stays readable on a phone if someone opens it between meetings, but phones are not the
design target and no install, offline or app-like behaviour is built for them.

Every interaction must still survive being done in under thirty seconds. These are architects
between other tasks, not people who will learn a tool.

## Constraints

- **Zero operating cost.** Vercel Hobby plus Supabase free tier.

  The spec rules Vercel out because its Hobby tier forbids commercial use. That does not
  apply here: the owner has confirmed this is a personal tool for his own use only, which is
  exactly what Hobby is licensed for. Decided; do not raise it again. Cloudflare Pages remains
  a drop-in alternative if the tool is ever used by the practice rather than by one person.
- **No backend server.** The browser talks to Supabase directly. Row Level Security is the
  authorisation layer. Never introduce an API server, a queue, a cron job, or anything that must
  stay running.

  `.github/workflows/migrate.yml` is not an exception to this. It is a script that runs on a
  push and exits, the same shape as the Vercel build beside it, and nothing depends on it
  being up. It exists because deploying the app and migrating the schema were two separate
  acts by a person, and the day they came apart every project screen broke.
- **A plain website.** No PWA, no manifest, no service worker, no offline mode, no install
  prompt. Decided after the spec was written; the spec's PWA sections are superseded.
- **Dependencies:** React, Vite, @supabase/supabase-js, date-fns. Adding to this list requires
  asking first. (`@vitejs/plugin-react` is the standard React/Vite glue, not a new capability.)

## Domain vocabulary

- **AR** architecture. **ID** interior design. **IR** interior renovation.
- **Stage group**: one of 8 phases. **Substage**: one of 21 units of work inside a stage group.
  This is the unit the studio actually tracks. **Deliverable**: a named drawing produced within
  a substage.
- **Role codes**: PI project initiation, DD design development, WD working drawing,
  PE project execution, CL closure, INVOLVED (advisory, owns no work).
- **GFC** good for construction. **Sanctioning** BBMP or BDA statutory plan approval.

## Rules that must never be violated

1. **`events` is append-only.** Every substage status change writes a row via the database
   trigger. Never update or delete an events row. All duration and stall metrics derive from it.
2. **A date that records something is never typed by a user.** `started_on` and `concluded_on`
   are stamped by the trigger. The old spreadsheet had six dates in total because manual date
   entry does not happen. Three dates are typed, and all three are *plans* rather than records:
   `project_substage.target_date`, `project_stage_group.target_date` (the section deadline) and
   `projects.target_delivery`. Nothing but a person knows a promise. Adding a fourth authorable
   date needs the same justification.
3. **Substages, stage groups and deliverables are never deleted.** Archive with `active = false`.
   Deleting one silently destroys duration history.
4. **A substage never changes stage group** once it has project data. Create a new one instead.
5. **Colour is decoration.** Every status must be readable as text. The tool exists because the
   previous system stored meaning in colour alone. The palette is deliberately lively, which
   raises the stakes on this rule rather than relaxing it: nothing on screen carries a colour
   without also carrying a word, charts included. Every figure on the analytics screen has a
   table twin behind its "Numbers" toggle for the same reason.
6. **Sundays are not days of work.** Every duration anywhere in the app - board, project screen,
   analytics - comes from `working_days()` (migration 0008) or its JavaScript twin in
   `src/lib/workdays.js`, both of which exclude Sundays. A plan quoted in weeks is read as six
   working days to the week, not seven. Two screens that disagree about how long something has
   taken are worse than either number, so both suites assert the same cases.
7. **`ensure_project_structure()` is the only definition of which sections a project gets.**
   The new-project form, the seed and the backfill all call it. Never reimplement that rule in
   the browser.
8. **A write shows on screen before the database answers, and goes back if it refuses.**
   Ten people use this between other tasks; a control that freezes for the length of a
   round trip is the difference between a tool they use and one they avoid. Use
   `optimistic()` in `src/lib/live.js`. Two conditions, and neither is optional: the revert
   must restore what the database actually holds, and the failure must be said out loud -
   optimism you cannot take back is just lying quickly. Anything the database decides
   (`started_on`, `concluded_on`, `done_on`) is read back from the returned row, never
   predicted here.
9. **Never send a field the user did not change, and never delete something to re-add it.**
   Use `changedFields()` and `diffAssignments()` in `src/lib/save.js`. A full-row update
   silently reverts whatever a colleague changed while the form was open, and only substage
   status changes are logged, so nothing would record that it happened. A delete-then-insert
   has a window with no team at all, and a failure in the middle leaves it that way.
10. **Every migration is idempotent, and a new one that is not is a bug.** There is no
   migration runner and by the constraints above there cannot be one, so applying a migration
   is a person pasting `ALL_MIGRATIONS.sql` into the SQL editor. That is only safe if the
   whole file is safe to paste from any state, so: `create table if not exists`,
   `create or replace function`, `drop policy if exists` before `create policy`, and
   `drop view if exists` before `create view` — never `create or replace view`, which cannot
   change a view's column list and will fail the moment a later migration reshapes it. Data a
   migration writes uses `on conflict do nothing`. `npm run test:converge` enforces this; never
   add a migration without running it.

## Product principles

- **Measure blockage, not progress.** Architectural projects stall, they do not creep forward.
  The board sorts by how far a project has run past the planned duration of its current substage.
- **No percent complete.** It is always back-derived from the fee stage and always fiction.
- **Show the gaps.** Twenty of 37 projects have no stage data. They appear on the board as
  "Not set". Never hide an empty row.
- **Four screens.** Board, Project detail, Analytics ("The numbers", which carries team
  load), and the new-project / edit panel that slides over any of them. Admin settings are
  still unbuilt; the taxonomy is edited in Supabase for now.
- **The board shows the substage that is stuck, not the first one.** 10 of 17 active projects run
  several substages at once, so a row reports the most overdue and counts the rest as "+N more".

## Explicitly out of scope

Gantt charts, percent complete, time tracking, client login, file storage, notifications,
invoicing, fee tracking, PWA install and offline support. Do not add these and do not scaffold
for them.

**"Blocked by" was removed from the product**, at the studio's request. The `blocks` table and
every row in it still exist; nothing reads them after migration 0012. Do not re-add the
feature, and do not drop the table on your own initiative either - that is history, and
dropping it is irreversible.
