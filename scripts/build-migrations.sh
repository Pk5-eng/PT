#!/usr/bin/env bash
# Concatenates supabase/migrations/*.sql into supabase/ALL_MIGRATIONS.sql, the
# single file anyone ever pastes into the Supabase SQL editor.
#
#     npm run build:migrations
#
# Run after changing any migration. The generated file is committed, because the
# people applying it are pasting from GitHub and have no terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
FILES=(supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql)

# This glob used to be `000*.sql`, which matched 0001 through 0009 and then
# silently stopped. Migrations 0010, 0011 and 0012 were left out of the
# generated file and nothing said so - the paste succeeded and produced a
# database missing three migrations. A silent gap in a generated file that
# people apply by hand is the worst possible failure, so the sequence is
# checked here and the build refuses rather than emitting a quiet lie.
[ ${#FILES[@]} -gt 0 ] || { echo "no migrations found" >&2; exit 1; }

EXPECTED=1
for f in "${FILES[@]}"; do
  n=$(basename "$f" | cut -c1-4)
  if [ "$((10#$n))" -ne "$EXPECTED" ]; then
    printf 'migration sequence breaks at %s: expected %04d\n' "$(basename "$f")" "$EXPECTED" >&2
    exit 1
  fi
  EXPECTED=$((EXPECTED + 1))
done

{
  cat <<'HDR'
-- ============================================================================
-- Kabra Architects dashboard - THE MIGRATION FILE
--
-- This is the only file you ever paste into the Supabase SQL editor, and you
-- paste the whole of it every time, whatever state the database is in.
--
--   a brand new project        -> it builds the whole schema
--   a database a few behind    -> it applies only what is missing
--   a database already current -> it changes nothing
--   pasted twice by mistake    -> it changes nothing
--
-- That is the point. There is no backend and no migration runner, so applying
-- a migration is a person pasting a file, and a person should never have to
-- work out WHICH file. Every migration below is idempotent, so there is only
-- ever one answer: this one.
--
-- Each migration is its own transaction, so a failure rolls back that file only
-- and the error names which one. Afterwards, run VERIFY.sql to see where the
-- database is.
--
-- Generated file. Do not edit. Edit the numbered migrations and run:
--     npm run build:migrations
-- ============================================================================
HDR
  echo
  for f in "${FILES[@]}"; do
    echo ""
    echo "-- ############################################################################"
    echo "-- ## $(basename "$f")"
    echo "-- ############################################################################"
    echo ""
    cat "$f"
  done
} > supabase/ALL_MIGRATIONS.sql

echo "wrote supabase/ALL_MIGRATIONS.sql (${#FILES[@]} migrations, $(wc -l < supabase/ALL_MIGRATIONS.sql) lines)"
