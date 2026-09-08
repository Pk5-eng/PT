import { lateness, idleReason, planDays } from '../lib/board.js';
import { toProject } from '../lib/route.js';

/**
 * One row's days figure.
 *
 * Two different numbers can make a row late and they must never be confused:
 *   days_in_substage  how long the work has actually been running, vs its plan
 *   days_past_target  how far past its target date it is
 *
 * Only the first belongs in a "days / plan" pair. Showing a target overrun
 * against a planned duration would read as elapsed time and be a lie, so when
 * there is no start date the row says so and reports the target overrun on its
 * own terms.
 */
function Days({ row }) {
  const late = lateness(row);
  const plan = planDays(row);

  if (!row.substage_name) return <span className="none">—</span>;

  const elapsed = row.days_in_substage;

  if (elapsed != null) {
    return (
      <div className={`days${late.late ? ' over' : ''}`}>
        <span className="big">{elapsed}</span>
        <span className="plan"> / {plan != null ? plan : '—'}</span>
        {late.late && <span className="why">{late.days} days {late.basis}</span>}
      </div>
    );
  }

  if (late.late) {
    return (
      <div className="days over">
        <span className="big">{late.days}</span>
        <span className="plan"> days</span>
        <span className="why">{late.basis}</span>
      </div>
    );
  }

  return (
    <div className="days">
      <span className="none">— / {plan != null ? plan : '—'}</span>
      <span className="why">not started</span>
    </div>
  );
}

function Substage({ row }) {
  if (!row.substage_name) return <span className="none">{idleReason(row)}</span>;
  return (
    <div>
      <div className="sub-name">
        {row.substage_name}
        {row.active_substage_count > 1 && (
          <span className="more" title={`${row.active_substage_count} substages in process`}>
            +{row.active_substage_count - 1} more
          </span>
        )}
      </div>
      {/* MATERIAL SELECTION exists in three stage groups, so the group name is
          never optional - see spec section 6.6. */}
      <div className="sub-group">{row.stage_group_name}</div>
    </div>
  );
}

function Team({ team }) {
  if (!team || team.length === 0) return <span className="none">—</span>;
  const working = team.filter((t) => t.role !== 'INVOLVED');
  const advisory = team.filter((t) => t.role === 'INVOLVED');
  const full = team.map((t) => `${t.name} (${t.role})`).join(', ');

  // With nobody owning work, the advisers are the only answer to "who is on
  // this?", so name them rather than reporting a count of nobody.
  if (working.length === 0) {
    return (
      <span className="team" title={full}>
        <span className="none">{advisory.map((t) => t.name).join(', ')} — advisory only</span>
      </span>
    );
  }

  return (
    <span className="team" title={full}>
      {working.map((t) => t.name).join(', ')}
      {advisory.length > 0 && <span className="more">+{advisory.length} advisory</span>}
    </span>
  );
}

export default function Board({ rows, teams }) {
  if (rows.length === 0) {
    return <p className="state">No projects match this filter.</p>;
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Current substage</th>
            <th>Days / plan</th>
            <th>Blocked by</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`clickable${lateness(r).late ? ' late' : ''}`}
                onClick={() => toProject(r.id)}>
              <td>
                <div className="pname">{r.name}</div>
                <div className="pmeta">{r.type}{r.code ? ` · ${r.code}` : ''}{r.status !== 'ongoing' ? ` · ${r.status}` : ''}</div>
              </td>
              <td><Substage row={r} /></td>
              <td><Days row={r} /></td>
              <td>{r.blocked_by ? <span className="blocked">{r.blocked_by}</span> : <span className="none">—</span>}</td>
              <td><Team team={teams[r.id]} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Below 640px the table becomes stacked cards: name and days on the top
          line, substage and blocker beneath. */}
      <div>
        {rows.map((r) => {
          const late = lateness(r);
          const plan = planDays(r);
          return (
            <div key={r.id} className={`rowcard clickable${late.late ? ' late' : ''}`}
                 onClick={() => toProject(r.id)}>
              <div className="line1">
                <span className="pname">{r.name}</span>
                <span className={`days${late.late ? ' over' : ''}`}>
                  {r.days_in_substage != null ? (
                    <><span className="big">{r.days_in_substage}</span><span className="plan"> / {plan ?? '—'}</span></>
                  ) : late.late ? (
                    <><span className="big">{late.days}</span><span className="plan"> days</span></>
                  ) : (
                    <span className="none">— / {plan ?? '—'}</span>
                  )}
                </span>
              </div>
              <div className="line2">
                {r.substage_name ? (
                  <>
                    {r.substage_name}
                    {r.active_substage_count > 1 && <span className="more">+{r.active_substage_count - 1} more</span>}
                    <span className="none"> · {r.stage_group_name}</span>
                  </>
                ) : (
                  <span className="none">{idleReason(r)}</span>
                )}
              </div>
              <div className="line3">
                {r.type}
                {late.late && <> · <span className="blocked">{late.days} days {late.basis}</span></>}
                {r.blocked_by && <> · <span className="blocked">blocked: {r.blocked_by}</span></>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
