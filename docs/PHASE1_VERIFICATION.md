# Phase 1: verified against a real Postgres

The migrations and seed were built from the spec without a database. They have now been
run against Postgres 16 from an empty schema, end to end, before touching Supabase.

Reproduce with `./test/run.sh` (see README). Current result: **all tests pass**, and the
spec's Phase 1 acceptance criterion — Madhu = 14 active assignments — passes against real
SQL rather than against the transform alone.

## Two bugs the testing found

**1. `create or replace view` cannot insert a column.** `0004` put `target_date` next to
`started_on` in `v_board`. Replace can only *append* columns, so it failed with
`cannot change name of view column "days_in_substage" to "target_date"`. The view is now
dropped and recreated, and its grants reapplied. This would have failed on first paste
into the Supabase SQL editor.

**2. The migrations were not atomic.** When `0004` failed at the view, its earlier
`alter table ... add column` had already committed, leaving the schema half-applied and
the file unable to re-run. All four migrations are now wrapped in `begin; ... commit;`,
so a failure rolls the whole file back, and the added column uses `if not exists`.

## What was tested

Trigger: `not_started -> in_process` stamps `started_on`; `-> done` stamps
`concluded_on`; moving off `done` clears `concluded_on`; every change writes an `events`
row attributed to the acting user; `target_date` survives status changes that clear
`concluded_on`.

RLS, as anon, member and admin: an anonymous visitor sees nothing and can change nothing;
a member reads everything and can move a status but cannot touch the taxonomy, the people
list, or forge, rewrite or delete an event; an admin can add and archive substages but
still cannot delete one.

**RLS denies a read by returning zero rows, not by raising an error.** An unauthorised
user therefore sees an empty app rather than a permission message. That matches the
spec's Phase 6 acceptance ("logging in from an outside address returns nothing") but it
is worth knowing when debugging: a blank board is what a broken login looks like. The
one exception is `v_board`, where an explicit `revoke` makes it raise.

## Two product findings the real data exposes

Neither blocks Phase 1. Both change what the Board screen should do in Phase 2, and both
are decisions for the firm rather than for me.

### The board will show one substage where seven are running

`v_board` picks a single "current" substage per project: the earliest `in_process` one by
`(stage_group.seq, substage.seq)`. The spec's Board design assumes that is a fair summary
of a project. The data says otherwise — **10 of the 17 projects with active work have
more than one substage in process**:

| project | in process |
|---|---|
| Ashok Ranka | 7 |
| Sidharth Upasana | 5 |
| Ketan Shah | 4 |
| Kuldeep Garg | 4 |
| Vinay Kothari, Basawaraj Patil, Sanjeev Bhutra, Congress Office, Srujan Reddy | 3 each |
| Manit Somani | 2 |

This is not bad data. Civil drawings, services and interiors genuinely run in parallel.
But it means the board as specified reports roughly a third of the live work, and always
the earliest-stage third — so a project can look stuck in `ELEVATION FINALISATION` while
the actual delay is in `SERVICES DRAWING`.

Options for Phase 2, cheapest first: show a count ("+6 more") next to the current
substage; show the *most overdue* in-process substage rather than the earliest; or give
each project a row per active substage. The first is nearly free and honest about the
gap. Worth deciding before the board is built, not after.

### Two finished projects are indistinguishable from twenty empty ones

`Surendra` (21 of 21 substages done) and `Mantri Blossom, 19th` (8 of 8 done) have no
`in_process` substage, so `v_board` shows them as "Not set" — exactly like the 20
projects that have no stage data at all. Twenty-two rows say "Not set" and mean two
completely different things.

Both are still `status = 'ongoing'`. If the work is genuinely finished, their status
should be `completed`, which is a data fix, not a code one. If there is remaining work
the spreadsheet never captured, they need substage rows. Someone in the studio has to say
which.
