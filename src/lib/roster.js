/**
 * The studio roster: who is on the team, and what happens when they leave.
 *
 * Kept out of the panel for the same reason board.js is kept out of the board.
 * Two of the three rules below are claims about people's records rather than
 * about pixels, and a claim should be readable without a form around it.
 *
 * 1. REMOVING SOMEONE IS AN ARCHIVE, NEVER A DELETE. A person is referenced by
 *    every assignment they hold and by every event they stamped, so deleting
 *    one would either fail on the reference or take the history with it. The
 *    database refuses it outright (migration 0013 revokes the privilege); this
 *    file makes sure the app never asks.
 *
 * 2. AN ARCHIVED PERSON STAYS ON THE PROJECTS THEY WERE ON. Archiving does not
 *    reach into assignments, because "Selva has left" and "Selva was never on
 *    Ashok Ranka" are different statements and only the first one is true. The
 *    panel therefore has to say how many live projects still list them, so the
 *    person doing the archiving knows what is left to hand over rather than
 *    finding out a week later.
 *
 * 3. A NAME IS THE WHOLE IDENTITY HERE. Nine of the ten rows in this table have
 *    no email at all, so the name is the only thing that tells two people
 *    apart, and a duplicate name is a genuine ambiguity rather than a tidiness
 *    complaint. It is refused, case- and space-insensitively.
 */

/** Trimmed, with runs of inner whitespace collapsed. "  Ravi   K " -> "Ravi K". */
export const cleanName = (s) => (s ?? '').trim().replace(/\s+/g, ' ');

const key = (s) => cleanName(s).toLowerCase();

/**
 * Why this person cannot be added, or null if they can.
 *
 * An archived namesake is its own answer, and a different one: the fix is to
 * restore that row rather than to create a second one, because the first one
 * carries their assignments and their events.
 */
export function nameProblem(name, people) {
  const n = cleanName(name);
  if (!n) return 'A name is needed.';
  if (n.length > 80) return 'That name is too long.';
  const clash = (people ?? []).find((p) => key(p.name) === key(n));
  if (!clash) return null;
  return clash.active
    ? `${clash.name} is already on the team.`
    : `${clash.name} is on the team already, archived. Restore them instead of adding a second row.`;
}

/**
 * An email, or null. Never '' - the column is unique, and two empty strings
 * are a collision where two nulls are not.
 */
export function cleanEmail(s) {
  const e = (s ?? '').trim().toLowerCase();
  return e === '' ? null : e;
}

/** Loose on purpose: this is a typo check, not an address validator. */
export function emailProblem(email, people, ignoreId = null) {
  const e = cleanEmail(email);
  if (e === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That does not look like an email address.';
  const clash = (people ?? []).find((p) => p.id !== ignoreId && (p.email ?? '').toLowerCase() === e);
  return clash ? `${clash.name} already signs in with that address.` : null;
}

/**
 * The roster in reading order: the team first, then the people who have left.
 *
 * Archived rows are listed rather than hidden. Showing the gaps is the whole
 * reason this tool exists, and "who used to be here" is the gap that explains
 * a name still sitting on a project.
 */
export function rosterOrder(people) {
  return [...(people ?? [])].sort((a, b) =>
    (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name));
}

/**
 * Live projects each person still owns work on, by person id.
 *
 * INVOLVED is excluded for the same reason it is excluded from the team load
 * figure: it is the advisory code and owns no work, so counting it would warn
 * about handing over work that was never held.
 */
export function liveLoad(assignments, projects) {
  const live = new Set((projects ?? []).filter((p) => p.status === 'ongoing').map((p) => p.id));
  const n = new Map();
  for (const a of assignments ?? []) {
    if (a.role_code === 'INVOLVED') continue;
    if (!live.has(a.project_id)) continue;
    n.set(a.person_id, (n.get(a.person_id) ?? 0) + 1);
  }
  return n;
}

/** What to warn about before archiving. Silence when there is nothing to hand over. */
export function archiveWarning(name, count) {
  if (!count) return null;
  return `${name} still owns work on ${count} live ${count === 1 ? 'project' : 'projects'}. `
    + `Archiving keeps them on ${count === 1 ? 'it' : 'them'} — hand the work over on the project screen.`;
}
