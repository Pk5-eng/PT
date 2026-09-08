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

/** Board order: most overdue first, then everything else by name. */
export function sortRows(rows) {
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
    return a.name.localeCompare(b.name);
  });
}

export function summarise(rows) {
  return {
    live: rows.filter((r) => r.status === 'ongoing').length,
    late: rows.filter((r) => lateness(r).late).length,
    blocked: rows.filter((r) => r.blocked_by).length,
  };
}

/** Planned duration in days, or null. Weeks are how the studio thinks; days are what we count. */
export function planDays(row) {
  return row.planned_weeks == null ? null : Math.round(row.planned_weeks * 7);
}
