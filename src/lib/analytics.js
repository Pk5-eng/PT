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

/** The median of a list of numbers, or null for an empty one. */
export function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * The four numbers above the figures. Each one is the headline of a figure
 * below it, so a reader never has to work out which chart a number came from.
 */
export function headline({ items, undated, rows }) {
  const late = overdue(items);
  const soon = dueWithin(items, 24);          // four working weeks
  const running = undated.reduce((n, s) => n + s.inProcess, 0);
  const total = undated.reduce((n, s) => n + s.value, 0);
  return {
    overdue: late.length,
    soon: soon.length,
    runningUndated: running,
    totalUndated: total,
    live: rows.filter((r) => r.status === 'ongoing').length,
    dated: items.length,
  };
}

/* ------------------------------------------------------- dated and undated -- */

/**
 * Every date anybody has committed to, as one list.
 *
 * Three kinds, because the studio commits at three levels and a person wants
 * them in one place rather than in three:
 *
 *   delivery  projects.target_delivery        - the whole job
 *   section   project_stage_group.target_date - a phase
 *   stage     project_substage.target_date    - one piece of work
 *
 * Counted in working days like everything else, so "in 12 days" here and "12
 * days" on the board mean the same twelve days.
 *
 * Nothing is inferred. A stage with no date does not borrow its section's, and
 * a section with no date does not borrow the project's delivery date; a date
 * nobody set is an absence, and undatedWork() below is where that absence is
 * reported. Inventing one here would make the gap invisible in both figures.
 */
export function deadlineItems({ projects = [], sections = [], stages = [] }, today = todayISO()) {
  const out = [];

  for (const p of projects) {
    if (!p.target_delivery) continue;
    out.push({
      key: `d:${p.id}`, kind: 'delivery', date: p.target_delivery,
      project: p.name, projectId: p.id, what: 'Project delivery',
      days: workingDays(today, p.target_delivery),
    });
  }
  for (const s of sections) {
    if (!s.target_date) continue;
    out.push({
      key: `g:${s.id}`, kind: 'section', date: s.target_date,
      project: s.project, projectId: s.project_id, what: s.section,
      days: workingDays(today, s.target_date),
    });
  }
  for (const s of stages) {
    if (!s.target_date) continue;
    // A finished stage's date is history, not a deadline.
    if (s.status === 'done' || s.status === 'cancelled' || s.status === 'not_in_scope') continue;
    out.push({
      key: `s:${s.id}`, kind: 'stage', date: s.target_date,
      project: s.project, projectId: s.project_id,
      what: s.substage, section: s.section, status: s.status,
      days: workingDays(today, s.target_date),
    });
  }

  // Soonest first, and the ones already past at the very top: a date you have
  // missed is more urgent than one you are about to.
  return out.sort((a, b) => a.days - b.days || a.project.localeCompare(b.project));
}

export const overdue = (items) => items.filter((i) => i.days < 0);
export const dueWithin = (items, days) => items.filter((i) => i.days >= 0 && i.days <= days);

/**
 * Work that is in scope, not finished, and carries no date of any kind.
 *
 * WHY THE SPLIT MATTERS. Migration 0011 gave every project its full section
 * structure, so most of these rows are stages nobody has begun - real, but not
 * urgent. A single total would be a number in the hundreds that says "you have
 * planned nothing", which is both alarming and useless.
 *
 * Split by status, the same list answers the question worth asking: how much
 * work is RUNNING RIGHT NOW with nothing to measure it against. That is the
 * short, actionable half, and it sits beside the long half rather than hiding
 * it.
 *
 * A stage counts as undated only if neither it nor its section carries a date.
 * A section deadline is a commitment that covers the stages inside it, so a
 * stage under a dated section is scheduled even without one of its own.
 */
export function undatedWork(stages, sectionOrder) {
  const empty = () => ({ inProcess: 0, notStarted: 0, items: [] });
  const bySection = new Map(sectionOrder.map((s) => [s, empty()]));

  for (const s of stages) {
    if (s.status !== 'in_process' && s.status !== 'not_started' && s.status !== 'hold') continue;
    if (s.target_date || s.section_target) continue;
    if (!bySection.has(s.section)) bySection.set(s.section, empty());
    const bucket = bySection.get(s.section);
    if (s.status === 'not_started') bucket.notStarted += 1;
    else bucket.inProcess += 1;                        // in_process and hold: work that has begun
    bucket.items.push(s);
  }

  return sectionOrder.map((label) => {
    const b = bySection.get(label) ?? empty();
    return { label, inProcess: b.inProcess, notStarted: b.notStarted,
             value: b.inProcess + b.notStarted, items: b.items };
  });
}
