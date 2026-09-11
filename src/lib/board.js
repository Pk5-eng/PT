// Shaping and wording for the board. Kept out of the component so the rules
// about what a row means can be read, and tested, on their own.
//
// Every day figure here is a WORKING day figure: v_board computes them with
// working_days(), which excludes Sundays, and compares them against a planned
// duration converted at six working days to the week. Nothing on screen counts
// a Sunday as a day of work.

import { workingDays, todayISO } from './workdays.js';

/**
 * A project the studio has finished.
 *
 * One predicate rather than a `status === 'completed'` test scattered through
 * four files, because every consequence of being completed hangs off it: the
 * row sinks to the bottom of the board, it stops being late, it stops being
 * "delivering soon", and it leaves the numbers screen entirely. A project that
 * was closed six months ago is not work coming at anybody, and counting it
 * would make every figure on this dashboard describe a studio that no longer
 * exists.
 *
 * Only 'completed'. 'cancelled' and 'npp' are also not live work, and arguably
 * belong here too - but nobody has asked for that, and quietly changing what
 * the four cards count is not a decision this predicate should make on its own.
 */
export const isCompleted = (row) => row.status === 'completed';

/**
 * Why a project is late, and by how much.
 *
 * Three signals, in the order they deserve to be believed:
 *
 *   days_over         past the planned duration of the substage. The real
 *                     measure, but it needs a start date.
 *   days_past_target  past the date someone set for that substage.
 *   days_past_section past the deadline set for the whole section.
 *
 * The spreadsheet recorded no start dates, so on day one days_over is null
 * everywhere and the other two carry the board. As statuses get moved in the
 * app, started_on accumulates and days_over takes over on its own.
 */
export function lateness(row) {
  // A finished project cannot be overdue. Its substages are left exactly as
  // they were - some of them still say "in process", because nobody walked the
  // list closing them - and reporting that stale overrun on a job that shipped
  // would be the board's loudest number describing its least relevant row.
  if (isCompleted(row)) return { days: null, basis: null, late: false };

  if (row.days_over != null && row.days_over > 0) {
    return { days: row.days_over, basis: 'past plan', late: true };
  }
  if (row.days_past_target != null && row.days_past_target > 0) {
    return { days: row.days_past_target, basis: 'past target', late: true };
  }
  if (row.days_past_section != null && row.days_past_section > 0) {
    return { days: row.days_past_section, basis: 'past section deadline', late: true };
  }
  return { days: null, basis: null, late: false };
}

/**
 * What a project with no substage in process actually is.
 *
 * Four different silences, and they are not the same thing. Since migration
 * 0011 every live project carries a full structure, so "no stages tracked" is
 * now rare and "not started" is the common one - but both stay, because the
 * distinction between "we have not decided anything" and "we decided and have
 * not begun" is exactly the gap this tool exists to show.
 */
export function idleReason(row) {
  if (!row.substage_count) return 'No stages tracked';
  if (!row.started_count) return 'Not started';
  if (row.done_count >= row.in_scope_count) return 'All stages done';
  return 'Nothing in process';
}

/** Working days until the promised delivery date. Negative once it has passed. */
export function deliveryIn(row) {
  if (row.days_to_delivery != null) return row.days_to_delivery;
  return row.target_delivery ? workingDays(todayISO(), row.target_delivery) : null;
}

/** Delivery is "soon" inside four working weeks, and stays soon once overdue. */
const SOON = 24;
export const deliverySoon = (row) => {
  if (isCompleted(row)) return false;   // nothing is still to be delivered
  const d = deliveryIn(row);
  return d != null && d <= SOON;
};

/**
 * Board order.
 *
 * 'overrun' is the default and the one the product is about: the board measures
 * blockage, not progress, so the row that has run furthest past its plan is the
 * row you should see first. The others exist because sometimes you are looking
 * for a project by name, or asking what ships next.
 */
export function sortRows(rows, key = 'overrun') {
  const byName = (a, b) => a.name.localeCompare(b.name);

  /**
   * Finished work sits below live work, in every one of the four orders.
   *
   * Applied here rather than inside each comparator because it has to hold
   * whichever one is chosen: sorted by name, a completed project called
   * "Ashok Ranka" would otherwise open the board, and the first thing anybody
   * read every morning would be a job that shipped last year. Sunk, never
   * dropped - the row is still there, still readable, still one click from its
   * screen. Hiding it would be the spreadsheet's mistake in a new coat.
   */
  const finishedLast = (a, b) => (isCompleted(a) ? 1 : 0) - (isCompleted(b) ? 1 : 0);

  if (key === 'name') return [...rows].sort((a, b) => finishedLast(a, b) || byName(a, b));

  if (key === 'delivery') {
    return [...rows].sort((a, b) => {
      const sunk = finishedLast(a, b);
      if (sunk) return sunk;
      const da = deliveryIn(a), db = deliveryIn(b);
      if ((da == null) !== (db == null)) return da == null ? 1 : -1;  // undated sink
      if (da != null && da !== db) return da - db;
      return byName(a, b);
    });
  }

  if (key === 'stage') {
    return [...rows].sort((a, b) => {
      const sunk = finishedLast(a, b);
      if (sunk) return sunk;
      const an = a.substage_name ?? '', bn = b.substage_name ?? '';
      if (!an !== !bn) return an ? -1 : 1;       // untracked rows sink, never vanish
      const g = (a.stage_group_name ?? '').localeCompare(b.stage_group_name ?? '');
      return g !== 0 ? g : an.localeCompare(bn) || byName(a, b);
    });
  }

  return [...rows].sort((a, b) => {
    const sunk = finishedLast(a, b);
    if (sunk) return sunk;
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

/**
 * The four numbers at the top of the board.
 *
 * None of them counts a completed project. `live` never did, by definition;
 * lateness() and deliverySoon() now refuse one on their own, so only the idle
 * count needs saying out loud. A finished project whose stages were never
 * ticked off would otherwise sit on the "Nothing started yet" card forever,
 * which is a true statement about the data and a false one about the studio.
 */
export function summarise(rows) {
  return {
    live: rows.filter((r) => r.status === 'ongoing').length,
    late: rows.filter((r) => lateness(r).late).length,
    soon: rows.filter(deliverySoon).length,
    // Since 0011 gave every project a structure, the gap this counts is work
    // nobody has begun rather than a project nobody has described. Still shown,
    // still never hidden - see CLAUDE.md, "show the gaps".
    idle: rows.filter(isIdle).length,
  };
}

const isIdle = (r) => !isCompleted(r) && !r.started_count;

/**
 * The four card filters. Exactly one can be on at a time.
 *
 * Each one is the same predicate the card counted, so clicking a number shows
 * exactly the rows behind it. That identity is why they are shared rather than
 * written twice: a card reading 6 and a filter showing 7 would be a bug nobody
 * would report and everybody would stop trusting.
 */
export const FOCUS = {
  live: (r) => r.status === 'ongoing',
  late: (r) => lateness(r).late,
  soon: deliverySoon,
  idle: isIdle,
};

/**
 * Free-text search. Matches what someone would actually type: a project, a
 * client, a stage they know is running, or a colleague's name.
 */
export function matches(row, q, team) {
  if (!q) return true;
  const hay = [
    row.name, row.code, row.client_name, row.type,
    row.substage_name, row.stage_group_name,
    ...(team ?? []).map((t) => t.name),
  ].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Planned duration in working days, or null. The view computes it; this is the fallback. */
export function planDays(row) {
  if (row.planned_days != null) return row.planned_days;
  return row.planned_weeks == null ? null : Math.round(row.planned_weeks * 6);
}
