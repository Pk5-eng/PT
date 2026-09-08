#!/usr/bin/env bash
# Verifies the migrations and the seed against a real Postgres before they go
# anywhere near Supabase. Builds a database from nothing every time.
#
#   ./test/run.sh
#
# Needs a running Postgres and PGURL set, e.g.
#   export PGURL="postgresql://postgres@/postgres?host=/tmp&port=5433"
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?set PGURL to a Postgres connection string}"

echo "resetting database"
psql "$PGURL" -q -c "drop schema public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null 2>&1

echo "applying Supabase shim (test only)"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f test/00_supabase_shim.sql

for f in supabase/migrations/*.sql; do
  printf 'applying %-40s' "$(basename "$f")"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f" && echo ok
done

echo "regenerating seed.sql from seed.json"
node scripts/seed.mjs --emit-sql >/dev/null

printf 'loading seed.sql%-31s' ''
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql && echo ok

echo
echo "=== Phase 1 acceptance: Madhu must be 14 ==="
psql "$PGURL" -q -c "select p.name, count(*) as active_assignments
  from assignments a join people p on p.id = a.person_id
  where a.role_code <> 'INVOLVED' and p.active
  group by p.name order by active_assignments desc;"

MADHU=$(psql "$PGURL" -tAc "select count(*) from assignments a join people p on p.id=a.person_id where a.role_code<>'INVOLVED' and p.active and p.name='Madhu';")
[ "$MADHU" = "14" ] && echo "ACCEPTANCE PASS (Madhu = 14)" || { echo "ACCEPTANCE FAIL (Madhu = $MADHU)"; exit 1; }

echo
psql "$PGURL" -q -f test/01_behaviour.sql

echo
# Run the RLS suite once and judge that single run: re-running it would act on
# state the first run already mutated.
RLS=$(psql "$PGURL" -q -t -f test/02_rls.sql 2>&1 | grep -v '^\s*$')
echo "$RLS"

echo
if echo "$RLS" | grep -q 'FAIL'; then
  echo "$(echo "$RLS" | grep -c 'FAIL') FAILURES"
  exit 1
fi
echo "ALL TESTS PASS"
