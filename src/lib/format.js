import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { workingDays, plannedWorkingDays, days as dayWord, todayISO } from './workdays.js';

/** "4 Mar" for this year, "4 Mar 2025" otherwise. Dates are read at a glance. */
export function shortDate(iso) {
  if (!iso) return null;
  const d = parseISO(iso);
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

export function longDate(iso) {
  return iso ? format(parseISO(iso), 'd MMM yyyy') : null;
}

export function dateTime(iso) {
  if (!iso) return null;
  return format(parseISO(iso), 'd MMM yyyy, HH:mm');
}

/** Status values, in the order a substage moves through them. */
export const STATUSES = [
  ['not_in_scope', 'Not in scope'],
  ['not_started', 'Not started'],
  ['in_process', 'In process'],
  ['hold', 'On hold'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
];

export const statusLabel = (s) => STATUSES.find(([v]) => v === s)?.[1] ?? s;

/** Project-level statuses, for the new-project and edit forms. */
export const PROJECT_STATUSES = [
  ['ongoing', 'Ongoing'],
  ['hold', 'On hold'],
  ['npp', 'Not proceeding'],
  ['not_confirmed', 'Not confirmed'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
];

export const projectStatusLabel = (s) =>
  PROJECT_STATUSES.find(([v]) => v === s)?.[1] ?? String(s ?? '').replace(/_/g, ' ');

export const ROLES = [
  ['PI', 'Project initiation'],
  ['DD', 'Design development'],
  ['WD', 'Working drawing'],
  ['PE', 'Project execution'],
  ['CL', 'Closure'],
  ['INVOLVED', 'Advisory (owns no work)'],
];

/**
 * The metadata line under a substage name: what is known, in words.
 * Never invents a date. A substage with no start date says so.
 *
 * Every duration is in working days. A substage started on a Saturday and
 * looked at on the following Monday is one day old here, not two.
 */
export function substageMeta(row) {
  const bits = [];
  const plan = plannedWorkingDays(row.planned_weeks);

  if (row.started_on) {
    bits.push(`started ${shortDate(row.started_on)}`);
    // A finished substage stops accruing days at its conclusion. Counting to
    // today would make every completed piece of work look progressively worse.
    const d = workingDays(row.started_on, row.concluded_on ?? todayISO());
    if (d != null) bits.push(dayWord(d));
  }
  if (row.concluded_on) bits.push(`done ${shortDate(row.concluded_on)}`);
  if (row.target_date) bits.push(`target ${shortDate(row.target_date)}`);
  if (plan != null) bits.push(`plan ${plan}`);

  return bits.length ? bits.join(', ') : 'no dates recorded';
}

/**
 * "3 days ago". The activity feed is read to answer "is this recent?", which a
 * relative figure answers instantly and a timestamp does not. The exact time
 * stays available in the title attribute, so nothing is lost.
 */
export function relative(iso) {
  if (!iso) return null;
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

/** "in 12 days" / "9 days ago" / "today", counted in working days. */
export function dueWording(workingDaysAway) {
  if (workingDaysAway == null) return null;
  if (workingDaysAway === 0) return 'due today';
  if (workingDaysAway > 0) return `in ${dayWord(workingDaysAway)}`;
  return `${dayWord(-workingDaysAway)} over`;
}
