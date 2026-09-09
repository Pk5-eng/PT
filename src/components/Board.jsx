import { lateness, idleReason, planDays, deliveryIn } from '../lib/board.js';
import { toProject } from '../lib/route.js';
import { shortDate, dueWording, projectStatusLabel } from '../lib/format.js';
import { Alert, Users, ArrowDown, ArrowUp, Dashed, Check, Clock, Calendar } from './Icons.jsx';

/**
 * One row's days figure. Working days: Sundays are not days of work, here or
 * anywhere else in the app.
 *
 * Two different numbers can make a row late and they must never be confused:
 *   days_in_substage  how long the work has actually been running, vs its plan
 *   days_past_target  how far past its target date, or its section deadline
 *
 * Only the first belongs in a "days / plan" pair. Showing a target overrun
 * against a planned duration would read as elapsed time and be a lie, so when
 * there is no start date the row says so and reports the overrun on its own
 * terms.
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
        {late.late && (
          <div><span className="why"><Alert size={11} />{late.days} days {late.basis}</span></div>
        )}
      </div>
    );
  }

  if (late.late) {
    return (
      <div className="days over">
        <span className="big">{late.days}</span>
        <span className="plan"> days</span>
        <div><span className="why"><Alert size={11} />{late.basis}</span></div>
      </div>
    );
  }

  return (
    <div className="days">
      <span className="none">— / {plan != null ? plan : '—'}</span>
      <span className="quiet">not started</span>
    </div>
  );
}

/**
 * The delivery date the studio committed to, and how far away it is in working
 * days. Replaces the "blocked by" column, which was removed from the product.
 */
function Delivery({ row }) {
  const left = deliveryIn(row);
  if (!row.target_delivery) return <span className="none">—</span>;
  const over = left != null && left < 0;
  const near = left != null && left >= 0 && left <= 12;
  return (
    <div className={`delivery${over ? ' over' : near ? ' near' : ''}`}>
      <span className="date">{shortDate(row.target_delivery)}</span>
      <span className="rel">{dueWording(left)}</span>
    </div>
  );
}

/** A project with nothing in process. Stated, never hidden or left blank. */
function Idle({ row }) {
  const why = idleReason(row);
  const Icon = why === 'All stages done' ? Check : Dashed;
  return <span className="gap"><Icon size={12} />{why}</span>;
}

function Substage({ row }) {
  if (!row.substage_name) return <Idle row={row} />;
  return (
    <div>
      <div className="sub-name">
        {row.substage_name}
        {row.active_substage_count > 1 && (
          <span className="more" title={`${row.active_substage_count} substages are in process; this is the most overdue`}>
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
      {advisory.length > 0 && <span className="more" title={`Advisory: ${advisory.map((t) => t.name).join(', ')}`}>+{advisory.length} advisory</span>}
    </span>
  );
}

/** A column header that sorts. The arrow shows on hover before it is active. */
function SortHead({ label, sortKey, sort, setSort, Icon }) {
  const active = sort === sortKey;
  // Name, stage and delivery read A-Z / soonest-first; overrun reads worst-first.
  const ascending = sortKey !== 'overrun';
  const Arrow = ascending ? ArrowUp : ArrowDown;
  return (
    <th className="sortable" aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort(sortKey)} title={`Sort by ${label.toLowerCase()}`}>
        {Icon && <Icon size={12} />}
        {label}
        <Arrow size={12} className={`arrow${active ? '' : ' off'}`} />
      </button>
    </th>
  );
}

export default function Board({ rows, teams, sort, setSort }) {
  const open = (id) => toProject(id);
  const onKey = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id); }
  };

  return (
    <>
      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <SortHead label="Project" sortKey="name" sort={sort} setSort={setSort} />
              <SortHead label="Current substage" sortKey="stage" sort={sort} setSort={setSort} />
              <SortHead label="Days / plan" sortKey="overrun" sort={sort} setSort={setSort} Icon={Clock} />
              <SortHead label="Delivery" sortKey="delivery" sort={sort} setSort={setSort} Icon={Calendar} />
              <th>Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`clickable t-${r.type}${lateness(r).late ? ' late' : ''}`}
                  tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => onKey(e, r.id)}>
                <td>
                  <div className="pname">{r.name}</div>
                  <div className="pmeta">
                    <span className={`tag tag-${r.type}`}>{r.type}</span>
                    {r.code && <span>{r.code}</span>}
                    {r.status !== 'ongoing' && <span>{projectStatusLabel(r.status)}</span>}
                  </div>
                </td>
                <td><Substage row={r} /></td>
                <td><Days row={r} /></td>
                <td><Delivery row={r} /></td>
                <td><Team team={teams[r.id]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Below 820px the table becomes stacked cards: name and days on the top
          line, substage and delivery beneath. */}
      <div className="rowcards">
        {rows.map((r) => {
          const late = lateness(r);
          const plan = planDays(r);
          const team = teams[r.id] ?? [];
          const working = team.filter((t) => t.role !== 'INVOLVED');
          const left = deliveryIn(r);
          return (
            <div key={r.id} className={`rowcard t-${r.type}${late.late ? ' late' : ''}`}
                 role="button" tabIndex={0}
                 onClick={() => open(r.id)} onKeyDown={(e) => onKey(e, r.id)}>
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
                  <Idle row={r} />
                )}
              </div>
              <div className="line3">
                <span className={`tag tag-${r.type}`}>{r.type}</span>
                {late.late && <span className="why"><Alert size={11} />{late.days} days {late.basis}</span>}
                {r.target_delivery && (
                  <span className={left != null && left < 0 ? 'overdue' : undefined}>
                    <Calendar size={12} /> {shortDate(r.target_delivery)} · {dueWording(left)}
                  </span>
                )}
                {working.length > 0 && <span><Users size={12} /> {working.map((t) => t.name).join(', ')}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
