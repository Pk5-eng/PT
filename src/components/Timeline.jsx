import { shortDate, dueWording } from '../lib/format.js';
import { days as dayWord } from '../lib/workdays.js';
import { Check, Calendar } from './Icons.jsx';

/**
 * The strip under the project heading: every section in order, then delivery.
 *
 * Each step states its status in words, its substage count, and one date -
 * a date the database recorded or a deadline a person typed, never one worked
 * out here. The circles and the coloured rule repeat what the words say; read
 * in greyscale the strip loses nothing (CLAUDE.md rule 5).
 *
 * Steps are evenly spaced on purpose. This is a sequence, not a time axis, and
 * the caption says so, so nobody reads a wide gap as a long phase.
 *
 * A step is a button: it opens that section and scrolls to it, which is the
 * thing someone looking at the strip wants next.
 */

function stepDates(st) {
  const lines = [];
  if (st.state === 'not_in_scope') return lines;
  if (st.state === 'done') {
    lines.push(st.finished_on ? `done ${shortDate(st.finished_on)}` : 'date not recorded');
    return lines;
  }
  if (st.started_on) lines.push(`since ${shortDate(st.started_on)}`);
  if (st.over) lines.push({ late: true, text: `${dayWord(st.over)} past deadline` });
  else if (st.deadline) lines.push(`due ${shortDate(st.deadline)}`);
  else if (!st.started_on) lines.push('no deadline');
  return lines;
}

export default function Timeline({ steps, delivery, deliveryIn, completed, onPick }) {
  if (steps.length === 0) return null;
  const deliveryLate = !completed && deliveryIn != null && deliveryIn < 0;

  return (
    <nav className="timeline" aria-label="Project timeline">
      <div className="tl-head">
        <span className="tl-title">Timeline</span>
        <span className="tl-note">one step per section, in order · not drawn to scale</span>
      </div>

      <ol className="tl-track">
        {steps.map((st, i) => {
          const prev = i === 0 ? 'start' : steps[i - 1].state;
          return (
            <li key={st.id} className={`tl-step ph-${st.state} from-${prev}${st.over ? ' late' : ''}`}>
              <button type="button" onClick={() => onPick(st.id)}
                      title={`${st.name} — ${st.label}. Go to this section.`}>
                <span className="tl-node" aria-hidden="true">
                  {st.state === 'done' ? <Check size={13} /> : i + 1}
                </span>
                <span className="tl-text">
                  <span className="tl-name">{st.name}</span>
                  <span className="tl-state">{st.label}</span>
                  {st.total > 0 && <span className="tl-count">{st.done} of {st.total} done</span>}
                  {stepDates(st).map((l) => (
                    typeof l === 'string'
                      ? <span key={l} className="tl-date">{l}</span>
                      : <span key={l.text} className="tl-date late">{l.text}</span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}

        <li className={`tl-step tl-end from-${steps.at(-1).state}${completed ? ' ph-done' : ''}${deliveryLate ? ' late' : ''}`}>
          <div className="tl-static">
            <span className="tl-node" aria-hidden="true">
              {completed ? <Check size={13} /> : <Calendar size={13} />}
            </span>
            <span className="tl-text">
              <span className="tl-name">Delivery</span>
              <span className="tl-state">
                {completed ? 'Project completed' : delivery ? shortDate(delivery) : 'No date set'}
              </span>
              {!completed && delivery && (
                <span className={`tl-date${deliveryLate ? ' late' : ''}`}>{dueWording(deliveryIn)}</span>
              )}
            </span>
          </div>
        </li>
      </ol>
    </nav>
  );
}
