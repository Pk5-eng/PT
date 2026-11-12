import { workingDays, todayISO } from './workdays.js';

/**
 * The project timeline: one step per section, in the order the studio works
 * through them.
 *
 * WHAT THIS IS NOT. It is not a Gantt chart and the steps are not drawn to a
 * time scale - every step is the same width, because the spreadsheet recorded
 * no start dates on two projects in three and a time axis would be drawn
 * mostly out of guesses. It is not percent complete either: nothing here is a
 * fraction of the job, only a count of substages per section, the same count
 * the section header already shows.
 *
 * NOTHING IS INFERRED. A step's date is a record the trigger stamped
 * (started_on, concluded_on) or the section deadline a person typed. A section
 * with neither says so rather than borrowing the project's delivery date.
 */

/** Statuses that are not live work: they neither count against nor towards a section. */
const OUT = new Set(['not_in_scope', 'cancelled']);

export const PHASE_LABELS = {
  done: 'Done',
  in_process: 'In process',
  hold: 'On hold',
  partly_done: 'Partly done',
  not_started: 'Not started',
  not_in_scope: 'Not in scope',
};

/**
 * One section's state, read from its substages.
 *
 * "In process" wins over "on hold" because a section with any live work is
 * moving. "Partly done" is a section with finished work and nothing in hand -
 * the stall this tool exists to surface, so it is named rather than folded
 * into "in process".
 */
export function phaseState(rows) {
  const live = rows.filter((r) => !OUT.has(r.status));
  if (live.length === 0) return 'not_in_scope';
  if (live.every((r) => r.status === 'done')) return 'done';
  if (live.some((r) => r.status === 'in_process')) return 'in_process';
  if (live.some((r) => r.status === 'hold')) return 'hold';
  if (live.some((r) => r.status === 'done')) return 'partly_done';
  return 'not_started';
}

const earliest = (xs) => xs.filter(Boolean).sort()[0] ?? null;
const latest = (xs) => xs.filter(Boolean).sort().at(-1) ?? null;

/**
 * Steps for the strip.
 *
 * groups:    [{ id, name, seq, rows: [{ status, started_on, concluded_on }] }]
 * deadlines: { [groupId]: 'YYYY-MM-DD' | null }
 *
 * `finished_on` is only given when every live substage carries a concluded_on;
 * the latest of a partial set would be a date the section did not finish on.
 * `over` is working days past the deadline, Sundays excluded, and only for a
 * section that is not done - a finished section is not late any more.
 */
export function timelineSteps(groups, deadlines = {}, today = todayISO()) {
  return groups.map((g) => {
    const state = phaseState(g.rows);
    const live = g.rows.filter((r) => !OUT.has(r.status));
    const deadline = deadlines[g.id] ?? null;
    const concluded = live.map((r) => r.concluded_on);
    const finished_on = state === 'done' && concluded.every(Boolean) ? latest(concluded) : null;
    const started_on = state === 'not_started' || state === 'not_in_scope'
      ? null : earliest(live.map((r) => r.started_on));
    let over = null;
    if (deadline && state !== 'done' && state !== 'not_in_scope') {
      const d = workingDays(deadline, today);
      if (d != null && d > 0) over = d;
    }
    return {
      id: g.id,
      name: g.name,
      state,
      label: PHASE_LABELS[state],
      done: live.filter((r) => r.status === 'done').length,
      total: live.length,
      started_on,
      finished_on,
      deadline,
      over,
    };
  });
}
