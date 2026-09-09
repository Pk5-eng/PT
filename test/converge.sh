#!/usr/bin/env bash
# Proves that ALL_MIGRATIONS.sql converges from ANY state.
#
#   ./test/converge.sh
#
# Needs a running Postgres and PGURL set. This is the test that matters most for
# a project with no migration runner: the whole safety of "just paste the file"
# rests on the file being safe to paste, from wherever the database happens to
# be, however many times.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?set PGURL to a Postgres connection string}"
export PGOPTIONS="-c client_min_messages=warning"

FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
reset () {
  psql "$PGURL" -q -c "drop schema public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null 2>&1
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f test/00_supabase_shim.sql
}
apply () { psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/ALL_MIGRATIONS.sql >/dev/null 2>&1; }
q () { psql "$PGURL" -tAc "$1"; }

check () {  # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then printf ' pass  %s\n' "$1"
  else printf ' FAIL  %s (got %s, wanted %s)\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}

# Everything the app needs, in one number, so a partial apply cannot look like
# a whole one.
current () {
  q "select
       (select count(*) from information_schema.tables where table_name in
          ('people','projects','stage_groups','substages','deliverables',
           'project_substage','project_deliverable','assignments','blocks',
           'events','project_stage_group','schema_migrations'))
     + (select count(*) from information_schema.columns where table_name='v_board'
          and column_name in ('target_delivery','days_to_delivery','section_target',
                              'days_past_section','in_scope_count','started_count','planned_days'))
     + (select count(*) from pg_proc where proname in
          ('stamp_and_log','is_admin','link_my_identity','stamp_deliverable',
           'working_days','planned_working_days','ensure_project_structure'))"
}
READY=26   # 12 tables + 7 board columns + 7 functions

echo "=== 1. a brand new database ==="
reset
apply
check "one paste builds the whole schema" "$(current)" "$READY"
check "and records all 12 migrations"    "$(q 'select count(*) from schema_migrations')" "12"

echo
echo "=== 2. the same database, pasted again ==="
apply
check "still current"            "$(current)" "$READY"
check "still 12 migrations"      "$(q 'select count(*) from schema_migrations')" "12"
check "no duplicate policies"    "$(q "select count(*) from pg_policies where schemaname='public' and policyname='read_all' and tablename='projects'")" "1"

echo
echo "=== 3. a database several migrations behind, holding real data ==="
# This is the state the live database was actually in: migrations 0001-0007
# applied months ago, seeded from the spreadsheet, and nothing since.
#
# seed.sql ends by calling ensure_project_structure(), which migration 0011
# creates - correct for a fresh install, where the migrations run first, but the
# historical seed had no such line. It is stripped here so this really is the
# old state and not a fresh one wearing its clothes.
reset
for n in 0001 0002 0003 0004 0005 0006 0007; do
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$(ls supabase/migrations/${n}_*.sql)" >/dev/null
done
grep -v 'ensure_project_structure' supabase/seed.sql > "$TMP/old_seed.sql"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$TMP/old_seed.sql" >/dev/null
BEFORE_DONE=$(q "select count(*) from project_substage where status='done'")
BEFORE_PROJ=$(q "select count(*) from projects")
apply
check "one paste brings it current"        "$(current)" "$READY"
check "projects untouched"                 "$(q 'select count(*) from projects')" "$BEFORE_PROJ"
check "finished work untouched"            "$(q "select count(*) from project_substage where status='done'")" "$BEFORE_DONE"
check "no project left without sections"   "$(q "select count(*) from projects p where p.status not in ('cancelled','completed') and not exists (select 1 from project_substage ps where ps.project_id=p.id)")" "0"
check "the backfill wrote no events"       "$(q 'select count(*) from events')" "0"

echo
echo "=== 4. pasted a third time on top of real data ==="
apply
check "nothing changed"                    "$(current)" "$READY"
check "finished work still untouched"      "$(q "select count(*) from project_substage where status='done'")" "$BEFORE_DONE"
check "no duplicate substages"             "$(q 'select count(*) from substages')" "25"
check "no duplicate indexes"               "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='project_substage_project_id_idx'")" "1"
check "no duplicate deliverables"          "$(q 'select count(*) from deliverables')" "58"
check "no duplicate people"                "$(q 'select count(*) from people')" "9"

echo
echo "=== 5. READY.sql tells the truth in both directions ==="
check "says READY on a current database" "$(q "$(cat supabase/READY.sql)")" "READY"
reset
for n in 0001 0002 0003; do
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$(ls supabase/migrations/${n}_*.sql)" >/dev/null
done
BEHIND=$(q "$(cat supabase/READY.sql)")
case "$BEHIND" in
  BEHIND*) printf ' pass  %s\n' "says BEHIND on a partial database" ;;
  *) printf ' FAIL  %s (got %s)\n' "says BEHIND on a partial database" "$BEHIND"; FAIL=$((FAIL+1)) ;;
esac
apply
check "and READY again after one paste"  "$(q "$(cat supabase/READY.sql)")" "READY"

echo
if [ "$FAIL" -gt 0 ]; then echo "$FAIL FAILURES"; exit 1; fi
echo "CONVERGES FROM EVERY STATE"
