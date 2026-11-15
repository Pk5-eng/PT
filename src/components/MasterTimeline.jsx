import { shortDate, dueWording } from '../lib/format.js';
import { days as dayWord } from '../lib/workdays.js';
import { deliveryIn } from '../lib/board.js';
import { toProject } from '../lib/route.js';
import { Check } from './Icons.jsx';

/**
 * Every live project in view against every section, on one grid.
 *
 * The project screen's timeline strip, stacked. Same rules, deliberately: one
 * evenly spaced column per section, so this is a sequence and not a Gantt
 * chart; every cell states its status in words, so the circles and the rail
 * only repeat what the text already says (CLAUDE.md rule 5); and the only
 * dates on it are ones the trigger stamped or a person typed.
 *
 * Read across, a row is one project's journey to delivery. Read down, a column
 * is the studio's load in that section - the header counts it so nobody has to.
 * A row opens its project.
 */

/** The one line under a cell's status. Never more than one, so rows stay one height. */
function subline(st) {
  if (st.state === 'untracked' || st.state === 'not_in_scope') return null;
  if (st.state === 'done') return st.finished_on ? { text: shortDate(st.finished_on) } : null;
  if (st.over) return { text: `${dayWord(st.over)} over`, late: true };
  if (st.deadline) return { text: `due ${shortDate(st.deadline)}` };
  if (st.state === 'not_started') return null;
  return { text: `${st.done} of ${st.total} done` };
}

/** What a cell says in full, for its tooltip and for a screen reader. */
function cellTitle(project, col, st) {
  const bits = [`${project} · ${col}: ${st.label}`];
  if (st.total > 0 && st.state !== 'not_in_scope') bits.push(`${st.done} of ${st.total} stages done`);
  if (st.started_on && st.state !== 'done') bits.push(`since ${shortDate(st.started_on)}`);
  if (st.finished_on) bits.push(`finished ${shortDate(st.finished_on)}`);
  if (st.deadline) bits.push(`section deadline ${shortDate(st.deadline)}`);
  if (st.over) bits.push(`${dayWord(st.over)} past it`);
  return bits.join(' · ');
}

function tallyLine(c) {
  const parts = [];
  if (c.in_process) parts.push(`${c.in_process} in process`);
  if (c.hold) parts.push(`${c.hold} on hold`);
  if (c.partly_done) parts.push(`${c.partly_done} partly done`);
  return parts.length ? parts.join(' · ') : 'nothing live';
}

function Band({ band, byId }) {
  return (
    <section className="mt-band">
      <h4 className="mt-band-h">
        {band.type && <span className={`tag tag-${band.type}`}>{band.type}</span>}
        {band.label}
        <span className="mt-band-n">{band.rows.length} {band.rows.length === 1 ? 'project' : 'projects'}</span>
      </h4>
      <div className="mt-scroll">
        <table className="mt" style={{ '--cols': band.columns.length }}>
          <colgroup>
            <col className="mt-c-name" />
            {band.columns.map((c) => <col key={c.id} />)}
            <col className="mt-c-del" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="mt-h-name">Project</th>
              {band.columns.map((c) => (
                <th key={c.id} scope="col" title={c.name}>
                  <span className="mt-col">{c.name}</span>
                  <span className="mt-tally">
                    {tallyLine(c)}
                    {c.late > 0 && <span className="late"> · {c.late} late</span>}
                  </span>
                </th>
              ))}
              <th scope="col">
                <span className="mt-col">Delivery</span>
                <span className="mt-tally">promised date</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {band.rows.map((r) => {
              const p = byId.get(r.id) ?? {};
              const din = deliveryIn(p);
              const dLate = din != null && din < 0;
              return (
                <tr key={r.id} className={r.late || dLate ? 'is-late' : undefined}
                    onClick={() => toProject(r.id)}>
                  <th scope="row" className="mt-name">
                    <button type="button" onClick={(e) => { e.stopPropagation(); toProject(r.id); }}
                            title={`Open ${r.name}`}>
                      <span className="mt-pname">{r.name}</span>
                      {(r.late || dLate) && <span className="mt-pmeta late">behind a deadline</span>}
                      {!r.late && !dLate && r.reach < 0 && <span className="mt-pmeta">nothing started</span>}
                    </button>
                  </th>
                  {r.steps.map((st, i) => {
                    const prev = i === 0 ? 'start' : r.steps[i - 1].state;
                    const sub = subline(st);
                    return (
                      <td key={st.id}
                          className={`mt-cell ph-${st.state} from-${prev}${st.over ? ' late' : ''}`}
                          title={cellTitle(r.name, band.columns[i].name, st)}>
                        <span className="mt-node" aria-hidden="true">
                          {st.state === 'done' && <Check size={11} />}
                        </span>
                        <span className="mt-state">{st.label}</span>
                        {sub && <span className={`mt-sub${sub.late ? ' late' : ''}`}>{sub.text}</span>}
                      </td>
                    );
                  })}
                  <td className={`mt-cell mt-del from-${r.steps.at(-1)?.state ?? 'start'}${dLate ? ' late' : ''}`}
                      title={p.target_delivery ? `${r.name} · delivery ${shortDate(p.target_delivery)}, ${dueWording(din)}` : `${r.name} · no delivery date set`}>
                    <span className="mt-node mt-end" aria-hidden="true" />
                    <span className="mt-state">{p.target_delivery ? shortDate(p.target_delivery) : 'No date set'}</span>
                    {p.target_delivery && (
                      <span className={`mt-sub${dLate ? ' late' : ''}`}>{dueWording(din)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MasterTimeline({ bands, projects }) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return bands.map((b) => <Band key={b.type || 'none'} band={b} byId={byId} />);
}

/** The key above the grid. Every state is already a word in its cell; this says what the words mean. */
export function MasterKey() {
  const items = [
    ['done', 'Done', 'every stage in the section finished'],
    ['in_process', 'In process', 'work under way now'],
    ['partly_done', 'Partly done', 'some finished, nothing in hand — a stall'],
    ['hold', 'On hold', 'begun, then stopped'],
    ['not_started', 'Not started', 'not reached yet'],
    ['not_in_scope', 'Not in scope', 'not part of this job'],
  ];
  return (
    <ul className="mt-key">
      {items.map(([k, label, what]) => (
        <li key={k} className={`ph-${k}`}>
          <span className="mt-node" aria-hidden="true">{k === 'done' && <Check size={10} />}</span>
          <strong>{label}</strong> <span>{what}</span>
        </li>
      ))}
    </ul>
  );
}
