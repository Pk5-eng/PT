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
3. **Substages, stage groups, deliverables and people are never deleted.** Archive with
   `active = false`. Deleting a substage silently destroys duration history; deleting a person
   would take every event they stamped with it, and the privilege is revoked outright
   (0003 for the taxonomy, 0013 for people). Archiving a person deliberately leaves their
   assignments alone: "Selva has left" and "Selva was never on Ashok Ranka" are different
   statements and only the first is true.
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
- **Four screens.** Board, Project detail, Analytics ("The numbers"), and the new-project /
  edit panel that slides over any of them. The team panel on the board is the fifth thing that
  slides over, not a fifth screen: it adds a person to the roster and archives one, and that is
  all it does. The rest of the taxonomy - stage groups, substages, deliverables, and anyone's
  admin role - is still edited in Supabase, and `role` and `auth_id` are not writable from the
  browser by anybody (migration 0013).
- **The numbers screen answers exactly three questions**, and the studio chose them: what is
  coming at me and what have I already missed; what work is nobody scheduling; who is carrying
  how much. Its person filter defaults to whoever is signed in, which is what makes the first
  one personal. Do not add a fourth figure without being asked — the screen was six figures
  once and was cut back on purpose.
- **Nothing on that screen is inferred.** A stage with no date does not borrow its section's,
  and a section does not borrow the project's delivery date. The second figure exists to count
  those absences, and it would be measuring its own guesses if the first had filled them in.
- **The board does not show elapsed-against-plan.** That column read "— / —, not started" on
  two rows in three, because the spreadsheet recorded no start dates. It is one "Overdue by"
  column now, and the elapsed figure lives on the project screen where a start date is visible.
  "On plan" is only written where something exists to be on plan against — a plan, a target or a
  section deadline. A row with none of those says nothing, because nothing is known about it.
- **The board does not name the substage.** It did, in a column of its own, and that column was
  removed at the studio's request: it was a wide block of uppercase, it wrapped on the long
  names, and it made every row a different height. The one thing it carried that nothing else
  did - a project with no work in process, and which silence that is - moved into the
  "Overdue by" cell, which held a dash on exactly those rows. Below 820px the stacked cards
  still name it, and count the rest as "+N more", because there is a line to spare there.
  The project screen is where the substages actually live.
- **Every board row is the same height, and every column the same width.** Declared widths on a
  fixed table layout, one row height, and content clamped to two lines with the full text in the
  cell's title. A table that sizes itself from its contents lets one long project name set the
  proportions for all 37 rows.

## Explicitly out of scope

Gantt charts, percent complete, time tracking, client login, file storage, notifications,
invoicing, fee tracking, PWA install and offline support. Do not add these and do not scaffold
for them.

**"Blocked by" was removed from the product**, at the studio's request. The `blocks` table and
every row in it still exist; nothing reads them after migration 0012. Do not re-add the
feature, and do not drop the table on your own initiative either - that is history, and
dropping it is irreversible.
