# Kabra Architects Project Dashboard

Web application replacing `KA_WORK_DISTRIBUTION.xlsx`, where every project's status was
stored as a cell background colour. 10 people, 37 projects, Bangalore.

- **Spec:** `KA_DASHBOARD_BUILD_SPEC.md`
- **Working rules for Claude Code:** `CLAUDE.md`
- **Decoded spreadsheet:** `seed.json`
- **Phase 0 audit and the decisions it forces:** `docs/PHASE0_AUDIT.md`

Zero operating cost: Cloudflare Pages + Supabase free tier. No backend server; the
browser talks to Postgres through PostgREST and Row Level Security is the authorisation
boundary.

## Status

| Phase | | |
|---|---|---|
| 0 | Repo and seed audit | **done** — `docs/PHASE0_AUDIT.md` |
| 1 | Schema and seed | **verified against Postgres 16, not yet applied to Supabase** — `docs/PHASE1_VERIFICATION.md` |
| 2 | Read-only board | **built, not yet deployed** |
| 3 | Project detail and status editing | **built** — sections, per-section deadlines, deliverables |
| 4 | New project and editing | **built** — slide-over panel, create and edit |
| 5 | Team load and derived metrics | **built** — the analytics screen. Blocks removed from the product |
| 6 | Auth and RLS | RLS applied. PWA install dropped by decision — see CLAUDE.md |

The five Phase 0 decisions are closed and recorded in `docs/PHASE0_AUDIT.md`. The
migrations and seed have been run end to end against a real Postgres and all tests pass
(`docs/PHASE1_VERIFICATION.md`); two bugs were found and fixed in the process. Phase 1 is
blocked only on Supabase credentials.

## Commands

```sh
npm install
npm run audit        # audit seed.json, print blockers and decisions
npm run audit:write  # same, also writes docs/PHASE0_AUDIT.txt
npm run seed:dry     # transform seed.json and print what would load, writes nothing
npm run seed:sql     # regenerate supabase/seed.sql for the Supabase SQL editor
npm run seed         # load over the network instead; needs SUPABASE_URL + SERVICE_ROLE_KEY
npm run dev          # the app, against your Supabase project
npm run test:js      # unit tests; needs nothing but Node
npm run test:sql     # migrations, seed and RLS against a real Postgres; needs PGURL
npm test             # both
```

`seed:dry` exits non-zero if the transform stops reproducing the spec's own acceptance
numbers (Madhu = 14 non-INVOLVED assignments, Selva = 7). Treat it as a test.

## Applying Phase 1

Two pastes into the Supabase SQL editor. That is the whole thing — no Node, no service
role key, no terminal.

1. Create a Supabase project (free tier).
2. Open **SQL Editor** → new query. Paste the *contents* of
   [`supabase/ALL_MIGRATIONS.sql`](supabase/ALL_MIGRATIONS.sql) and Run.
   That is every migration in order: schema, trigger and board view, Row Level Security,
   the `target_date` column, the most-overdue board, identity linking, deliverable
   stamping, working-day arithmetic, section deadlines, the taxonomy additions, the
   project-structure function and the current board view.
3. New query. Paste the *contents* of [`supabase/seed.sql`](supabase/seed.sql) and Run.
4. New query. Verify:

```sql
select p.name, count(*) as active_assignments
from assignments a
join people p on p.id = a.person_id
where a.role_code <> 'INVOLVED' and p.active
group by p.name
order by active_assignments desc;
```

Madhu must return 14.

To get the file contents: open the file on GitHub, click **Raw**, select all, copy.
`seed.sql` is ~48 KB and pastes fine.

Both files are generated. After changing a migration run `npm run build:migrations`;
after changing `seed.json` or the decisions in `scripts/seed.mjs` run `npm run seed:sql`.

RLS is applied in step 2, not deferred to Phase 6 as the spec sequences it. Until those
policies exist the anon key reads and writes everything, and Phase 2 puts a public URL in
front of this database.

### If you prefer the network path

`cp .env.example .env`, fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then
`npm run seed:dry` followed by `npm run seed`. Same result; the SQL editor route just
needs less setup.

## Verifying before you touch Supabase

There are two suites.

`npm run test:js` needs nothing but Node. It pins the working-day arithmetic, what a board
row means, and every figure the analytics screen puts on screen.

`npm run test:sql` builds a database from nothing, applies every migration, loads the seed
and asserts the trigger, the board view, the working-day functions, the project-structure
backfill and every RLS policy. `npm test` runs both. The SQL suite needs a local Postgres:

```sh
sudo apt-get install -y postgresql
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/katest -A trust -U postgres
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/katest -o '-p 5433 -k /tmp' start
export PGURL="postgresql://postgres@/postgres?host=/tmp&port=5433"
./test/run.sh
```

`test/00_supabase_shim.sql` recreates the bits of Supabase the migrations rely on
(`auth.uid()`, the `anon` and `authenticated` roles). It is test-only and is never applied
to Supabase.

## Things to know before changing anything

- `events` is append-only and every duration metric derives from it.
- Users never type dates. The trigger stamps `started_on` and `concluded_on`.
- Substages, stage groups and deliverables are archived (`active = false`), never deleted.
- `stage_groups.seq` is not in `seed.json`; it comes from array order, and `v_board` uses
  it to decide which substage a project is currently on.
- **Every day count excludes Sundays.** `working_days()` in migration 0008 and
  `src/lib/workdays.js` are the same arithmetic, and both test suites assert the same
  cases so they cannot drift apart. A plan quoted in weeks is read as six working days to
  the week, not seven.
- A user still never types a date that *records* something. `target_date`,
  `project_stage_group.target_date` and `projects.target_delivery` are the three
  exceptions, and all three are plans rather than records.
- `ensure_project_structure()` is the single definition of which sections a project gets.
  The new-project form, the seed and the backfill all call it, so they cannot disagree.
- **The app tolerates being newer than the database, but never silently.** There is no
  migration step in the build and by CLAUDE.md there cannot be one, so the window where
  the deployed app is ahead of the schema is normal. A query for something *additive* may
  fail without taking the screen down; when it does, `src/lib/schema.js` recognises the
  PostgREST code and a banner names the migration to run. It deliberately does not treat a
  permission error as schema drift — that would hide an RLS mistake, which is the whole
  authorisation boundary here.
- "Blocked by" was removed from the product. The `blocks` table and its rows still exist
  and nothing reads them; dropping it is a deliberate one-line follow-up, not a leftover.
- Dependencies are fixed by spec: React, Vite, `@supabase/supabase-js`, `date-fns`.
  Adding to that list requires asking first. The charts are hand-written SVG and CSS for
  this reason.


## Running it locally

```sh
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

The anon key is public by design — it ships in the browser bundle. RLS is the boundary,
and every policy requires a signed-in user, so the anon key alone reads nothing. The
service role key belongs only in seeding, never in the app.

## Deploying

The build is a static Vite bundle: `npm run build`, output in `dist/`.

**Vercel**, on the Hobby tier. `vercel.json` sets the framework, build command, output
directory and the SPA rewrite, so a connected repo needs no dashboard configuration beyond
the two environment variables below. Pushing to the branch triggers a build.

Hobby is licensed for personal, non-commercial use, which is what this is. If the tool ever
becomes something the practice uses rather than one person, move it to Cloudflare Pages —
same build command, same output directory, no code changes.

Whichever host you use, set both environment variables on it:

| variable | value |
|---|---|
| `VITE_SUPABASE_URL` | your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | the anon / public key |

Vite inlines these at build time, so **adding them requires a redeploy** — setting them on
a build that already ran will not take effect. If they are missing, the app says so on
screen rather than rendering blank.

