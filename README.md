# Kabra Architects Project Dashboard

Installable PWA replacing `KA_WORK_DISTRIBUTION.xlsx`, where every project's status was
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
| 2 | Read-only board | not started |
| 3 | Project detail and status editing | not started |
| 4 | New project and inline editing | not started |
| 5 | Blocks, team load, derived metrics | not started |
| 6 | Auth, RLS and PWA install | RLS written, not applied |

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
```

`seed:dry` exits non-zero if the transform stops reproducing the spec's own acceptance
numbers (Madhu = 14 non-INVOLVED assignments, Selva = 7). Treat it as a test.

## Applying Phase 1

Two pastes into the Supabase SQL editor. That is the whole thing — no Node, no service
role key, no terminal.

1. Create a Supabase project (free tier).
2. Open **SQL Editor** → new query. Paste the *contents* of
   [`supabase/ALL_MIGRATIONS.sql`](supabase/ALL_MIGRATIONS.sql) and Run.
   That is migrations 0001–0004 in order: schema, trigger and board view, Row Level
   Security, and the `target_date` column.
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

`test/` builds a database from nothing, applies all four migrations, loads the seed and
asserts the trigger, the board view and every RLS policy. It needs a local Postgres:

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
- Dependencies are fixed by spec: React, Vite, `@supabase/supabase-js`, `date-fns`,
  `vite-plugin-pwa`. Adding to that list requires asking first.
