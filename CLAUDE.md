# Kabra Architects Project Dashboard

Installable PWA for a 10-person architecture practice in Bangalore. Replaces a spreadsheet
where project status was encoded as cell background colour.

Full specification: `KA_DASHBOARD_BUILD_SPEC.md`. Migration data: `seed.json`.

## Users

Nine studio members plus the principal. Non-technical. Most access will be on a phone, standing
on a site or between meetings. Every interaction must survive being done one-handed in under
thirty seconds.

## Constraints

- **Zero operating cost.** Cloudflare Pages (free, commercial use permitted) plus Supabase free
  tier. Vercel Hobby is not an option, it forbids commercial use.
- **No backend server.** The browser talks to Supabase directly. Row Level Security is the
  authorisation layer. Never introduce an API server, a queue, a cron job, or anything that must
  stay running.
- **PWA, not native.** Manifest plus service worker, installed from the browser. Native
  distribution would cost 99 USD a year for Apple alone.
- **Dependencies:** React, Vite, @supabase/supabase-js, date-fns, vite-plugin-pwa. Adding to this
  list requires asking first.

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
2. **Dates are never typed by a user.** `started_on` and `concluded_on` are stamped by the
   trigger. The old spreadsheet had six dates in total because manual date entry does not happen.
3. **Substages, stage groups and deliverables are never deleted.** Archive with `active = false`.
   Deleting one silently destroys duration history.
4. **A substage never changes stage group** once it has project data. Create a new one instead.
5. **Colour is decoration.** Every status must be readable as text. The tool exists because the
   previous system stored meaning in colour alone.

## Product principles

- **Measure blockage, not progress.** Architectural projects stall, they do not creep forward.
  The board sorts by how far a project has run past the planned duration of its current substage.
- **No percent complete.** It is always back-derived from the fee stage and always fiction.
- **Show the gaps.** Twenty of 37 projects have no stage data. They appear on the board as
  "Not set". Never hide an empty row.
- **Four screens plus admin settings.** Board, Project detail, New project, Team load, Settings.

## Explicitly out of scope

Gantt charts, percent complete, time tracking, client login, file storage, notifications,
invoicing, fee tracking. Do not add these and do not scaffold for them.
