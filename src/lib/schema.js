/**
 * Telling "the database is a migration behind" apart from "something is wrong".
 *
 * WHY THIS EXISTS
 *
 * The browser talks to Postgres directly, so a deploy of the app and a change
 * to the schema are two separate acts by two different people at two different
 * moments. There is no migration step wired into the build, and by CLAUDE.md
 * there cannot be one - no backend server, no job runner. So the window where
 * the app is newer than the database is not an edge case, it is the normal
 * consequence of the architecture, and the app has to behave well inside it.
 *
 * It did not. A missing project_stage_group - one optional table, holding one
 * optional date - took the entire project screen down and printed
 * "Could not find the table 'public.project_stage_group' in the schema cache"
 * at an architect. That is a disproportionate failure and an unreadable one.
 *
 * The rule now: a query for something ADDITIVE may fail without taking the
 * screen with it, but it may never fail silently. The feature switches off, and
 * a banner says which migration is missing. Degrading quietly would be the
 * worse bug of the two, because nobody would ever run the migration.
 *
 * PostgREST reports a missing object as a 404 with one of these codes rather
 * than raising, so this is a matter of reading them, not of catching.
 */

/** The file to paste into the Supabase SQL editor. Named in every message. */
export const MIGRATION_FILE = 'MIGRATE_0008_0012.sql';

const MISSING = new Set([
  'PGRST202',   // function not found in the schema cache
  'PGRST204',   // column not found in the schema cache
  'PGRST205',   // table not found in the schema cache
  '42P01',      // undefined_table
  '42703',      // undefined_column
  '42883',      // undefined_function
]);

/**
 * True when an error means "this object does not exist yet", rather than
 * "you are not allowed" or "the network is down". Both of those must keep
 * surfacing as themselves.
 */
export function isSchemaBehind(error) {
  if (!error) return false;
  if (error.code && MISSING.has(error.code)) return true;
  // Older PostgREST builds send the sentence without a code.
  return /could not find the (table|function|column|'[^']*' column)/i.test(error.message ?? '');
}

/**
 * The board view gains columns in the same migration that adds the table, so a
 * row that came back without them says the same thing without costing a second
 * request. An empty board tells us nothing either way, so it is not evidence.
 */
export function boardIsBehind(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return !('started_count' in rows[0]);
}
