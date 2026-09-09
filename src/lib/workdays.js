/**
 * Working days, Sundays excluded.
 *
 * The studio works a six-day week, so a calendar-day duration overstates every
 * piece of work by about a seventh. Asked for explicitly, and applied
 * everywhere rather than only on the analytics screen: two screens that
 * disagree about how long something has taken are worse than either number.
 *
 * This is the JavaScript twin of working_days() in migration 0008. The database
 * is the source of truth for anything the board shows; these exist for the
 * analytics screen, which derives figures the view does not carry, and for the
 * new-project form, which has to reason about a date before anything is saved.
 * Both must agree, so both count the same way: the number of Sundays in the
 * half-open interval (a, b], from a floor division anchored on a known Sunday.
 */

const MS_PER_DAY = 86400000;

/** 2000-01-02, a Sunday, as a day number since the Unix epoch. */
const SUNDAY_ANCHOR = 10958;

/** Days since 1970-01-01, computed in UTC so a timezone can never shift a date. */
export function dayNumber(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
  }
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY);
}

/** Today, as the ISO date the browser's own calendar is showing. */
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const sundaysUpTo = (n) => Math.floor((n - SUNDAY_ANCHOR) / 7);

/**
 * Elapsed days from `from` to `to`, not counting Sundays.
 * Negative when `to` is earlier than `from`, which is how "days remaining"
 * is read on a delivery date that has not arrived yet.
 */
export function workingDays(from, to = todayISO()) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a == null || b == null) return null;
  return (b - a) - (sundaysUpTo(b) - sundaysUpTo(a));
}

/** A planned duration in weeks, in working days. Six to the week, not seven. */
export function plannedWorkingDays(weeks) {
  return weeks == null ? null : Math.round(weeks * 6);
}

/** "12 days" / "1 day". Used often enough to be worth not repeating. */
export function days(n) {
  return `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
}
