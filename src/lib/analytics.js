/**
 * Everything the analytics screen counts.
 *
 * Kept out of the components for the same reason board.js is: these are claims
 * about the studio's work, and a claim should be readable without reading an
 * SVG around it.
 *
 * ONE RULE GOVERNS EVERY DURATION HERE: Sundays are not days of work. Asked for
 * explicitly, and applied to every figure rather than only the headline one, so
 * that the number on this screen and the number on the board are the same
 * number. workingDays() is the same arithmetic as working_days() in the
 * database - see src/lib/workdays.js.
 *
 * The other rule is that nothing is invented. A substage with no start date
 * contributes no days; it is not assumed to have started when the project did.
 * A project with no delivery date is absent from the delivery figures rather
 * than being given a guess.
 */

import { workingDays, todayISO } from './workdays.js';
import { lateness } from './board.js';

const byCountDesc = (a, b) => b.value - a.value || a.label.localeCompare(b.label);

/**
 * Working days spent on a project: the sum over its substages of how long each
 * one has actually been running. A finished substage stops accruing at its
 * conclusion; a running one counts to today; one that never started counts zero.
 *
 * Substages run in parallel here - 10 of 17 active projects have several going
 * at once - so this is effort across the project, not its elapsed lifetime. The
 * screen says so rather than letting the reader assume otherwise.
 */
export function daysSpent(subs, today = todayISO()) {
  let total = 0;
  for (const s of subs) {
    if (!s.started_on) continue;
    const d = workingDays(s.started_on, s.concluded_on ?? today);
    if (d != null && d > 0) total += d;
  }
  return total;
}

/** Top projects by working days spent. The user's headline question. */
export function spendByProject(rows, subsByProject, limit = 12) {
  const today = todayISO();
  return rows
    .map((r) => ({
      id: r.id,
      label: r.name,
      value: daysSpent(subsByProject[r.id] ?? [], today),
      meta: r.type,
    }))
    .filter((d) => d.value > 0)
    .sort(byCountDesc)
    .slice(0, limit);
}

/** Projects furthest past a plan, a target or a section deadline. */
export function overdueByProject(rows, limit = 12) {
  return rows
    .map((r) => {
      const late = lateness(r);
      return {
        id: r.id,
        label: r.name,
        value: late.days ?? 0,
        meta: late.basis,
        substage: r.substage_name,
      };
    })
    .filter((d) => d.value > 0)
    .sort(byCountDesc)
    .slice(0, limit);
}

/**
 * Where live work is sitting: in-process substages per section.
 *
 * Counted on substages, not projects, because a project can be running work in
 * three sections at once and picking one of them would be a choice the data
 * does not support.
 */
export function sectionLoad(subs, sectionOrder) {
  const n = new Map(sectionOrder.map((s) => [s, 0]));
  for (const s of subs) {
    if (s.status !== 'in_process') continue;
    n.set(s.section, (n.get(s.section) ?? 0) + 1);
  }
  return sectionOrder.map((label) => ({ label, value: n.get(label) ?? 0 }));
}

/**
 * Team load: live projects where a person owns work.
 *
 * INVOLVED is excluded on purpose. It is the advisory code and owns no work, so
 * counting it would put the principal at the top of a load chart he is not
 * carrying. Same rule the seed's acceptance test uses.
 */
export function teamLoad(teamsByProject, rows) {
  const live = new Set(rows.filter((r) => r.status === 'ongoing').map((r) => r.id));
  const n = new Map();
  for (const [projectId, team] of Object.entries(teamsByProject)) {
    if (!live.has(projectId)) continue;
    for (const t of team) {
      if (t.role === 'INVOLVED') continue;
      n.set(t.name, (n.get(t.name) ?? 0) + 1);
    }
  }
  return [...n].map(([label, value]) => ({ label, value })).sort(byCountDesc);
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Substages concluded per month, for the last `months` months including this
 * one. Derived from the events log, which is append-only and is the only honest
 * record of when work was actually called finished.
 *
 * Empty months are kept. A gap in the studio's output is a fact about the
 * studio, and dropping the month would draw a line straight over it.
 */
export function throughput(events, months = 12, now = new Date()) {
  const buckets = [];
  const index = new Map();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = `${MONTH[d.getMonth()]}${d.getMonth() === 0 || i === months - 1 ? ` ${String(d.getFullYear()).slice(2)}` : ''}`;
    index.set(key, buckets.length);
    buckets.push({ label, value: 0, key });
  }
  for (const e of events) {
    if (e.to_status !== 'done') continue;
    const d = new Date(e.at);
    const at = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (at != null) buckets[at].value += 1;
  }
  return buckets;
}

/** Project counts by status, in the order the statuses are worth reading. */
export function statusMix(rows, order) {
  const n = new Map(order.map((s) => [s, 0]));
  for (const r of rows) n.set(r.status, (n.get(r.status) ?? 0) + 1);
  return order.map((label) => ({ label, value: n.get(label) ?? 0 })).filter((d) => d.value > 0);
}

/** The median of a list of numbers, or null for an empty one. */
export function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** The four numbers at the top of the analytics screen. */
export function headline(rows, subs, events, now = new Date()) {
  const running = subs.filter((s) => s.status === 'in_process' && s.started_on);
  const today = todayISO();
  const ages = running
    .map((s) => workingDays(s.started_on, today))
    .filter((d) => d != null && d >= 0);

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const concluded30 = events.filter((e) => e.to_status === 'done' && new Date(e.at) >= cutoff).length;

  return {
    live: rows.filter((r) => r.status === 'ongoing').length,
    late: rows.filter((r) => lateness(r).late).length,
    medianAge: median(ages),
    concluded30,
    running: running.length,
  };
}
