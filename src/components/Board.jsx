import { lateness, idleReason, deliveryIn, isCompleted } from '../lib/board.js';
import { toProject } from '../lib/route.js';
import { shortDate, dueWording, projectStatusLabel } from '../lib/format.js';
import { Alert, Users, ArrowDown, ArrowUp, Dashed, Check, Clock, Calendar } from './Icons.jsx';

/**
 * How late this row is: the board's whole reason for existing, and now a column
 * of its own rather than half of a "days / plan" pair.
 *
 * The pair is gone because it was mostly empty. It read "— / —, not started" on
 * two rows in three: the spreadsheet recorded no start dates, so there was no
 * elapsed figure to set against a plan, and a column that blank earns none of
 * the width it takes. The elapsed-against-plan figure is still on the project
 * screen, where a start date is something you can actually see.
 *
 * Three states, and the third is the point. "On plan" is a CLAIM, and it is only
 * available when something exists to judge against: a planned duration the work
 * has been running against, a target date, or a section deadline. Twenty of
 * these projects have none of those, and writing "on plan" against them would
 * be inventing reassurance out of an absence - exactly what the spreadsheet did
 * with an uncoloured cell. Those rows say nothing, because nothing is known.
 */
function Late({ row }) {
  // A finished project has no overrun to report, and its stages were left where
  // they stood, so the figure this cell would otherwise show is the stale
  // overrun of work that shipped. It says what actually happened instead - in a
  // word, because the green is decoration and the word is the status.
  if (isCompleted(row)) {
    return <span className="finished"><Check size={12} />Completed</span>;
  }

  const late = lateness(row);
  // A project with nothing in process has no overrun to report, and this cell
  // was the "—" that said so twice over. It says which silence it is instead:
  // the substage column that used to carry that wording is gone, and showing
  // the gaps rather than blanking them is the point (CLAUDE.md).
  if (!row.substage_name) return <Idle row={row} />;

  if (late.late) {
    return (
      <div className="days over">
        <span className="big">{late.days}</span>
        <span className="plan"> days</span>
        <div className="basis">{late.basis}</div>
      </div>
    );
  }

  const judgeable = row.days_over != null
    || row.days_past_target != null
    || row.days_past_section != null;
  return judgeable
    ? <span className="onplan">on plan</span>
    : <span className="none" title="No plan, target or section deadline to judge this against">—</span>;
}

/**
 * The delivery date the studio committed to, and how far away it is in working
 * days. Replaces the "blocked by" column, which was removed from the product.
 */
function Delivery({ row }) {
  const left = deliveryIn(row);
  if (!row.target_delivery) return <span className="none">—</span>;
  // The date a finished project was due is history, not a countdown. Kept on
  // screen, because it is a fact about the job; stripped of the urgency, because
  // "40 days over" in red on a project that is done is simply not true.
  if (isCompleted(row)) {
    return <div className="delivery"><span className="date">{shortDate(row.target_delivery)}</span></div>;
  }
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
          {/* Declared widths, so a row is the same shape whatever is in it. The
              browser's automatic layout sized every column from its longest
              cell, which meant one project called "Basawaraj Patil, Kalaburagi"
              and one team of five set the proportions for all 37 rows. */}
          <colgroup>
            <col className="c-project" />
            <col className="c-late" />
            <col className="c-delivery" />
            <col className="c-team" />
          </colgroup>
          <thead>
            <tr>
              <SortHead label="Project" sortKey="name" sort={sort} setSort={setSort} />
              <SortHead label="Overdue by" sortKey="overrun" sort={sort} setSort={setSort} Icon={Clock} />
              <SortHead label="Delivery" sortKey="delivery" sort={sort} setSort={setSort} Icon={Calendar} />
              <th>Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}
                  className={`clickable t-${r.type}${lateness(r).late ? ' late' : ''}${isCompleted(r) ? ' finished' : ''}`}
                  tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => onKey(e, r.id)}>
                <td>
                  {/* Clamped to two lines in a fixed-height row, so the full
                      name has to live somewhere the mouse can still reach. */}
                  <div className="pname" title={r.name}>{r.name}</div>
                  <div className="pmeta">
                    <span className={`tag tag-${r.type}`}>{r.type}</span>
                    {r.code && <span>{r.code}</span>}
                    {r.status !== 'ongoing' && <span>{projectStatusLabel(r.status)}</span>}
                  </div>
                </td>
                <td><Late row={r} /></td>
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
          const finished = isCompleted(r);
          const team = teams[r.id] ?? [];
          const working = team.filter((t) => t.role !== 'INVOLVED');
          const left = deliveryIn(r);
          return (
            <div key={r.id} className={`rowcard t-${r.type}${late.late ? ' late' : ''}${finished ? ' finished' : ''}`}
                 role="button" tabIndex={0}
                 onClick={() => open(r.id)} onKeyDown={(e) => onKey(e, r.id)}>
              <div className="line1">
                <span className="pname">{r.name}</span>
                {late.late && (
                  <span className="days over">
                    <span className="big">{late.days}</span><span className="plan"> days</span>
                  </span>
                )}
                {finished && <span className="finished"><Check size={12} />Completed</span>}
              </div>
              {/* There is a line to spare here, so the card still names the
                  substage the table dropped - but not on a finished project,
                  where the name is whatever was last in process and says
                  nothing true about where the job stands. */}
              <div className="line2">
                {finished ? (
                  <span className="none">Finished. Its stages are left as they stood.</span>
                ) : r.substage_name ? (
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
                  <span className={!finished && left != null && left < 0 ? 'overdue' : undefined}>
                    <Calendar size={12} /> {shortDate(r.target_delivery)}
                    {!finished && ` · ${dueWording(left)}`}
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
