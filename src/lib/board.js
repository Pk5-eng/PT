// Shaping and wording for the board. Kept out of the component so the rules
// about what a row means can be read, and tested, on their own.

/**
 * Why a project is late, and by how much.
 *
 * days_over is the real measure: days past the planned duration of the current
 * substage. It needs a start date, and the spreadsheet recorded none, so on day
 * one it is null everywhere and days_past_target carries the board instead.
 * As statuses get moved in the app started_on accumulates and days_over takes
 * over on its own.
 */
export function lateness(row) {
  if (row.days_over != null && row.days_over > 0) {
    return { days: row.days_over, basis: 'past plan', late: true };
  }
  if (row.days_past_target != null && row.days_past_target > 0) {
    return { days: row.days_past_target, basis: 'past target', late: true };
  }
  return { days: null, basis: null, late: false };
}

/** What a project with no substage in process actually is. */
export function idleReason(row) {
  if (row.substage_count === 0) return 'No stages tracked';
  if (row.done_count === row.substage_count) return 'All stages done';
  return 'Nothing in process';
}

/**
 * Board order.
 *
 * 'overrun' is the default and the one the product is about: the board measures
 * blockage, not progress, so the row that has run furthest past its plan is the
 * row you should see first. The other two keys exist because sometimes you are
 * looking for a project by name rather than reading the board.
 */
export function sortRows(rows, key = 'overrun') {
  const byName = (a, b) => a.name.localeCompare(b.name);

  if (key === 'name') return [...rows].sort(byName);

  if (key === 'stage') {
    return [...rows].sort((a, b) => {
      const an = a.substage_name ?? '', bn = b.substage_name ?? '';
      if (!an !== !bn) return an ? -1 : 1;       // untracked rows sink, never vanish
      const g = (a.stage_group_name ?? '').localeCompare(b.stage_group_name ?? '');
      return g !== 0 ? g : an.localeCompare(bn) || byName(a, b);
    });
  }

  return [...rows].sort((a, b) => {
    const la = lateness(a), lb = lateness(b);
    if (la.late !== lb.late) return la.late ? -1 : 1;
    if (la.late && lb.late) {
      if (la.days !== lb.days) return lb.days - la.days;
    }
    // A project doing something outranks one doing nothing.
    const aActive = a.substage_name ? 1 : 0;
    const bActive = b.substage_name ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return byName(a, b);
  });
}

export function summarise(rows) {
  return {
    live: rows.filter((r) => r.status === 'ongoing').length,
    late: rows.filter((r) => lateness(r).late).length,
    blocked: rows.filter((r) => r.blocked_by).length,
    // 20 of 37 projects have no stage data at all. That number is a finding,
    // not an embarrassment to hide: it is the first thing the studio has to
    // decide about. See CLAUDE.md, "Show the gaps".
    untracked: rows.filter((r) => r.substage_count === 0).length,
  };
}

/** The four card filters. Exactly one can be on at a time. */
export const FOCUS = {
  live:      (r) => r.status === 'ongoing',
  late:      (r) => lateness(r).late,
  blocked:   (r) => !!r.blocked_by,
  untracked: (r) => r.substage_count === 0,
};

/**
 * Free-text search. Matches what someone would actually type: a project, a
 * client, a stage they know is running, or a colleague's name.
 */
export function matches(row, q, team) {
  if (!q) return true;
  const hay = [
    row.name, row.code, row.client_name, row.type,
    row.substage_name, row.stage_group_name, row.blocked_by,
    ...(team ?? []).map((t) => t.name),
  ].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Planned duration in days, or null. Weeks are how the studio thinks; days are what we count. */
export function planDays(row) {
  return row.planned_weeks == null ? null : Math.round(row.planned_weeks * 7);
}
