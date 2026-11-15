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

/**
 * The master timeline on the numbers screen: every project in view, one row
 * each, against the same columns - every section in studio order.
 *
 * It is the project screen's strip stacked, and it obeys the same rules: one
 * evenly spaced column per section, not a time axis, and no date on it that a
 * person did not type or the trigger did not stamp. Read across, a row says
 * where one project is; read down, a column says what the studio has in that
 * section right now.
 *
 * projects: v_board rows   ({ id, name, type, target_delivery, ... })
 * stages:   [{ project_id, group_id, group, group_seq, status, started_on, concluded_on }]
 * sections: [{ project_id, group_id, target_date }]
 *
 * A project with no substages at all in a section gets 'untracked', not 'not in
 * scope': nobody decided that section was out, it was simply never set up, and
 * those are different statements (CLAUDE.md, "show the gaps").
 *
 * Rows come back in sequence order - the project furthest through the job
 * first - so the grid reads as a staircase and the eye finds a project by where
 * it is rather than by searching a name. A project nothing has started on sinks
 * to the bottom; it is still there.
 */
export function masterTimeline({ projects = [], stages = [], sections = [] }, today = todayISO()) {
  const columns = [...new Map(stages.map((s) => [s.group_id, { id: s.group_id, name: s.group, seq: s.group_seq }])).values()]
    .sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));

  const rowsOf = new Map();
  for (const s of stages) {
    const k = `${s.project_id}::${s.group_id}`;
    if (!rowsOf.has(k)) rowsOf.set(k, []);
    rowsOf.get(k).push(s);
  }
  const deadlineOf = new Map(sections.map((s) => [`${s.project_id}::${s.group_id}`, s.target_date ?? null]));

  const rows = projects.map((p) => {
    const groups = columns.map((c) => ({ id: c.id, name: c.name, rows: rowsOf.get(`${p.id}::${c.id}`) ?? [] }));
    const deadlines = Object.fromEntries(columns.map((c) => [c.id, deadlineOf.get(`${p.id}::${c.id}`) ?? null]));
    const steps = timelineSteps(groups, deadlines, today).map((st, i) => (
      groups[i].rows.length === 0 ? { ...st, state: 'untracked', label: 'No stages', deadline: null, over: null } : st
    ));

    // How far through the job: the last section anything has happened in.
    let reach = -1;
    steps.forEach((st, i) => {
      if (st.state !== 'not_started' && st.state !== 'not_in_scope' && st.state !== 'untracked') reach = i;
    });
    return {
      id: p.id, name: p.name, type: p.type, status: p.status,
      steps, reach,
      late: steps.some((st) => st.over),
    };
  }).sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name));

  return { columns, rows };
}

const QUIET = new Set(['not_in_scope', 'untracked']);
const DISCIPLINE = { AR: 'Architecture', ID: 'Interior design', IR: 'Interior renovation' };

/**
 * The master timeline split into one band per discipline.
 *
 * An AR project and an ID project do not share sections: each gets the other
 * discipline's sections out of scope. One grid for both was half "Not in
 * scope" cells, which is noise a reader has to look through to find the work.
 * So each band keeps only the columns where at least one of its own projects
 * has something in scope - read off the data, never off a rule about which
 * type gets which section (that rule lives in ensure_project_structure() and
 * nowhere else). A section an AR project unusually has interiors in still
 * shows up in the AR band, because the data says so.
 *
 * Each column carries what its band holds, so its header can say "3 in
 * process" and nobody has to count a column by eye.
 */
export function masterBands({ columns, rows }) {
  const types = [...new Set(rows.map((r) => r.type ?? ''))]
    .sort((a, b) => (Object.keys(DISCIPLINE).indexOf(a) + 1 || 99) - (Object.keys(DISCIPLINE).indexOf(b) + 1 || 99));

  return types.map((type) => {
    const mine = rows.filter((r) => (r.type ?? '') === type);
    const keep = columns
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => mine.some((r) => !QUIET.has(r.steps[i].state)));
    const n = (i, state) => mine.filter((r) => r.steps[i].state === state).length;
    return {
      type,
      label: DISCIPLINE[type] ?? 'No discipline set',
      columns: keep.map(({ c, i }) => ({
        ...c,
        in_process: n(i, 'in_process'),
        hold: n(i, 'hold'),
        partly_done: n(i, 'partly_done'),
        done: n(i, 'done'),
        late: mine.filter((r) => r.steps[i].over).length,
      })),
      rows: mine.map((r) => ({ ...r, steps: keep.map(({ i }) => r.steps[i]) })),
    };
  });
}
