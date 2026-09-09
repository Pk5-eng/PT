/**
 * Working out the smallest honest write.
 *
 * Two rules, both learned from the shapes these functions replace.
 *
 * 1. NEVER SEND A FIELD THE USER DID NOT CHANGE. Ten people share this board.
 *    Sending a whole row back means whatever a colleague changed while your
 *    form was open is silently reverted by your save - you would not see it,
 *    they would not be told, and the events table would not record it because
 *    only substage status changes are logged. Sending only what actually moved
 *    means two people editing different fields of one project both win.
 *
 * 2. NEVER DELETE SOMETHING IN ORDER TO RE-ADD IT. Replacing a team with
 *    "delete every row, then insert the new set" has a window in the middle
 *    where the project has no team at all, and if the insert fails - a dropped
 *    connection, an RLS refusal, a closed laptop - it stays that way. The old
 *    comment in ProjectPanel said a diff "would be more code for a result
 *    nobody can tell apart". That was wrong: the difference is invisible right
 *    up until it costs you the data.
 */

/** Treats null, undefined and '' as the same absence, which is what a form means. */
const same = (a, b) => (a ?? '') === (b ?? '');

/**
 * The fields that actually changed, as a patch. Empty object means the user
 * opened the form, changed nothing, and pressed save - which should write
 * nothing at all rather than touching every column.
 */
export function changedFields(before, after) {
  const patch = {};
  for (const key of Object.keys(after)) {
    if (!same(before?.[key], after[key])) patch[key] = after[key];
  }
  return patch;
}

/**
 * How to get from the team a project has to the team the form wants, without
 * ever passing through "no team".
 *
 *   before  rows as loaded: [{ person_id, role_code }]
 *   after   the form's state: { person_id: role_code }
 *
 * Removals are deletes, additions are inserts, and a person whose role changed
 * is an update rather than a delete plus an insert - so their row keeps its id
 * and nothing referencing it is disturbed.
 */
export function diffAssignments(before, after) {
  const had = new Map((before ?? []).map((a) => [a.person_id, a.role_code]));
  const want = new Map(Object.entries(after ?? {}));

  const added = [];
  const changed = [];
  for (const [personId, role] of want) {
    if (!had.has(personId)) added.push({ person_id: personId, role_code: role });
    else if (had.get(personId) !== role) changed.push({ person_id: personId, role_code: role });
  }

  const removed = [];
  for (const personId of had.keys()) if (!want.has(personId)) removed.push(personId);

  return { added, changed, removed };
}

/** Nothing to write. Worth asking before opening a connection to say so. */
export const isNoop = (d) =>
  d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0;
