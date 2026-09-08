import { format, parseISO, formatDistanceToNow } from 'date-fns';

/** "4 Mar" for this year, "4 Mar 2025" otherwise. Dates are read at a glance. */
export function shortDate(iso) {
  if (!iso) return null;
  const d = parseISO(iso);
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

export function dateTime(iso) {
  if (!iso) return null;
  return format(parseISO(iso), 'd MMM yyyy, HH:mm');
}

export function daysBetween(iso, to = new Date()) {
  if (!iso) return null;
  return Math.floor((to - parseISO(iso)) / 86400000);
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

/**
 * The metadata line under a substage name: what is known, in words.
 * Never invents a date. A substage with no start date says so.
 */
export function substageMeta(row) {
  const bits = [];
  const plan = row.planned_weeks == null ? null : Math.round(row.planned_weeks * 7);

  if (row.started_on) {
    bits.push(`started ${shortDate(row.started_on)}`);
    // A finished substage stops accruing days at its conclusion. Counting to
    // today would make every completed piece of work look progressively worse.
    const end = row.concluded_on ? parseISO(row.concluded_on) : new Date();
    const d = daysBetween(row.started_on, end);
    if (d != null) bits.push(`${d} ${d === 1 ? 'day' : 'days'}`);
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
