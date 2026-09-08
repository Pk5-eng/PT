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
| 1 | Schema and seed | **code ready, not applied** — needs a Supabase project |
| 2 | Read-only board | not started |
| 3 | Project detail and status editing | not started |
| 4 | New project and inline editing | not started |
| 5 | Blocks, team load, derived metrics | not started |
| 6 | Auth, RLS and PWA install | RLS written, not applied |

Phase 1 is blocked on five decisions listed at the end of `docs/PHASE0_AUDIT.md`, and on
Supabase credentials. Nothing has been written to any database.

## Commands

```sh
npm install
npm run audit        # audit seed.json, print blockers and decisions
npm run audit:write  # same, also writes docs/PHASE0_AUDIT.txt
npm run seed:dry     # transform seed.json and print what would load, writes nothing
npm run seed         # load into Supabase; needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

`seed:dry` exits non-zero if the transform stops reproducing the spec's own acceptance
numbers (Madhu = 14 non-INVOLVED assignments, Selva = 7). Treat it as a test.

## Applying Phase 1

1. Create a Supabase project (free tier).
2. Run the migrations in order, in the SQL editor:
   - `supabase/migrations/0001_schema.sql` — tables and indexes
   - `supabase/migrations/0002_trigger_and_view.sql` — the stamping trigger and `v_board`
   - `supabase/migrations/0003_rls.sql` — Row Level Security
3. `cp .env.example .env` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. `npm run seed:dry`, read the warnings, then `npm run seed`.
5. Verify in the SQL editor:

```sql
select p.name, count(*) as active_assignments
from assignments a
join people p on p.id = a.person_id
where a.role_code <> 'INVOLVED' and p.active
group by p.name
order by active_assignments desc;
```

Madhu must return 14.

Apply RLS (step 2c) before putting real data behind a public URL, not at Phase 6. Until
those policies exist the anon key reads and writes everything.

## Things to know before changing anything

- `events` is append-only and every duration metric derives from it.
- Users never type dates. The trigger stamps `started_on` and `concluded_on`.
- Substages, stage groups and deliverables are archived (`active = false`), never deleted.
- `stage_groups.seq` is not in `seed.json`; it comes from array order, and `v_board` uses
  it to decide which substage a project is currently on.
- Dependencies are fixed by spec: React, Vite, `@supabase/supabase-js`, `date-fns`,
  `vite-plugin-pwa`. Adding to that list requires asking first.
