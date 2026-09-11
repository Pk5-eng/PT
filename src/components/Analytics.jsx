import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Figure, Bars, StackedBars, Tile } from './Charts.jsx';
import { statusLabel, shortDate, dueWording } from '../lib/format.js';
import { isSchemaBehind } from '../lib/schema.js';
import SchemaNotice from './SchemaNotice.jsx';
import {
  deadlineItems, overdue, dueWithin, dateCoverage, teamLoad, headline,
} from '../lib/analytics.js';
import { isCompleted } from '../lib/board.js';
import { Alert, ArrowLeft, Calendar, Users, Dashed, Check } from './Icons.jsx';

/**
 * The numbers screen.
 *
 * Three questions, which are the three the studio asked for:
 *
 *   what is coming at me, and what have I already missed
 *   what work is nobody scheduling
 *   who is carrying how much
 *
 * SUNDAYS ARE NOT COUNTED, here or anywhere else in the app.
 *
 * NOTHING IS INFERRED. A stage with no date does not borrow its section's, a
 * section does not borrow the project's delivery date, and an absent date is
 * reported as an absence rather than filled in. The second figure exists
 * precisely to count those absences, and it would be measuring its own guesses
 * if the first figure had already papered over them.
 *
 * NO PERCENT COMPLETE and nothing derived from a fee stage. Every figure is a
 * count of something a person actually recorded.
 *
 * The filters sit in one row above every figure and scope all three at once.
 * The person filter defaults to whoever is signed in - that is what makes the
 * first figure a personal snapshot rather than a studio-wide list - and moving
 * it to "Anyone" turns the same three figures into the principal's view.
 */

const TYPES = [['', 'All'], ['AR', 'AR'], ['ID', 'ID'], ['IR', 'IR']];

/** Four working weeks. The horizon a studio actually plans against. */
const SOON = 24;

const KIND = { delivery: 'Delivery', section: 'Section', stage: 'Stage' };

/**
 * The four segments, in stacking order.
 *
 * The order is load-bearing twice over. It reads work-in-flight then
 * work-not-begun, undated first inside each pair, so the eye lands on the red.
 * And it keeps the two warm colours apart: red beside orange fails the
 * normal-vision separation floor outright (delta-E 10.8 against a floor of 15),
 * so they cannot be neighbours in a stack however sensible the grouping looks.
 * Validated as this exact sequence; do not re-sort it to taste.
 */
const UNDATED_PARTS = [
  { key: 'runningUndated',    label: 'running, no date',     color: 'var(--status-critical)' },
  { key: 'runningDated',      label: 'running, dated',       color: 'var(--series-1)' },
  { key: 'notStartedUndated', label: 'not started, no date', color: 'var(--series-2)' },
  { key: 'notStartedDated',   label: 'not started, dated',   color: 'var(--series-3)' },
];

export default function Analytics({ onBack }) {
  const [rows, setRows] = useState(null);
  const [subs, setSubs] = useState([]);
  const [sections, setSections] = useState([]);
  const [teams, setTeams] = useState({});
  const [me, setMe] = useState(null);
  const [behind, setBehind] = useState(false);
  const [error, setError] = useState(null);

  const [type, setType] = useState('');
  const [person, setPerson] = useState(null);      // null = not yet defaulted

  const load = useCallback(async () => {
    // Returns this user's row in `people`, which is what makes the default view
    // personal. Harmless to call again; the app calls it on every board load.
    const { data: myId } = await supabase.rpc('link_my_identity');

    const [board, ps, as, psg, who] = await Promise.all([
      supabase.from('v_board').select('*'),
      supabase
        .from('project_substage')
        .select('id, project_id, status, target_date, substages(name, stage_groups(name, seq))'),
      supabase.from('assignments').select('project_id, person_id, role_code, people(id, name)'),
      supabase.from('project_stage_group').select('id, project_id, target_date, stage_groups(name, seq)'),
      myId ? supabase.from('people').select('id, name').eq('id', myId).single() : { data: null },
    ]);

    const failed = [board, ps, as].find((r) => r.error);
    if (failed) return setError(failed.error.message);
    setError(null);
    setBehind(isSchemaBehind(psg.error));

    const projectName = Object.fromEntries(board.data.map((r) => [r.id, r.name]));

    setRows(board.data);
    setSubs(ps.data.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      project: projectName[r.project_id] ?? '—',
      status: r.status,
      target_date: r.target_date,
      substage: r.substages?.name ?? null,
      section: r.substages?.stage_groups?.name ?? null,
      section_seq: r.substages?.stage_groups?.seq ?? 99,
    })));
    setSections((psg.data ?? []).map((r) => ({
      id: r.id,
      project_id: r.project_id,
      project: projectName[r.project_id] ?? '—',
      section: r.stage_groups?.name ?? 'Section',
      target_date: r.target_date,
    })));

    const byProject = {};
    for (const a of as.data) {
      if (!a.people?.name) continue;
      (byProject[a.project_id] ||= []).push({ name: a.people.name, role: a.role_code });
    }
    setTeams(byProject);
    setMe(who?.data?.name ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Default to the signed-in person once, and only if they actually own work.
  // Someone with no projects would otherwise land on an empty screen and have
  // to work out that it was a filter rather than the truth.
  const people = useMemo(
    () => [...new Set(Object.values(teams).flat().map((t) => t.name))].sort(), [teams]);
  useEffect(() => {
    if (person !== null || people.length === 0) return;
    setPerson(me && people.includes(me) ? me : '');
  }, [me, people, person]);

  const model = useMemo(() => {
    if (!rows || person === null) return null;

    // A completed project leaves this screen entirely, before any figure is
    // computed. All three questions here are about work that is still coming -
    // what is due, what nobody has scheduled, who is carrying it - and a job
    // that shipped answers none of them. Its missed deadlines are not misses
    // anybody can still act on, and its unscheduled stages are not a backlog.
    // Dropping it here rather than inside each figure is what keeps the three
    // consistent with each other and with the board.
    const keep = rows.filter((r) =>
      !isCompleted(r) &&
      (!type || r.type === type) &&
      (!person || (teams[r.id] ?? []).some((t) => t.name === person)));
    const ids = new Set(keep.map((r) => r.id));

    const myStages = subs.filter((s) => ids.has(s.project_id));
    const mySections = sections.filter((s) => ids.has(s.project_id));

    // A stage sitting under a dated section is scheduled even without a date of
    // its own, so undatedWork() needs to know. Nothing is inferred onto the
    // stage itself - this only marks that a commitment covers it.
    const sectionDate = new Map(
      mySections.filter((s) => s.target_date).map((s) => [`${s.project_id}::${s.section}`, s.target_date]));
    const stages = myStages.map((s) => ({
      ...s, section_target: sectionDate.get(`${s.project_id}::${s.section}`) ?? null,
    }));

    const order = [...new Map(subs.map((s) => [s.section, s.section_seq]))]
      .filter(([n]) => n).sort((a, b) => a[1] - b[1]).map(([n]) => n);

    const items = deadlineItems({ projects: keep, sections: mySections, stages });
    const coverage = dateCoverage(stages, order);

    return {
      rows: keep,
      items,
      late: overdue(items),
      soon: dueWithin(items, SOON),
      coverage,
      team: teamLoad(Object.fromEntries(Object.entries(teams).filter(([id]) => ids.has(id))), keep),
      head: headline({ items, coverage, rows: keep }),
    };
  }, [rows, subs, sections, teams, type, person]);

  if (error) {
    return <div className="state"><Alert size={26} /><strong>Could not load the numbers</strong>{error}</div>;
  }
  if (!model) {
    return (
      <div className="wrap">
        <div style={{ paddingTop: 24 }}>
          <div className="skel" style={{ height: 26, width: 220, marginBottom: 18 }} />
          {[...Array(3)].map((_, i) => <div key={i} className="skel" style={{ height: 150, marginBottom: 12 }} />)}
        </div>
      </div>
    );
  }

  const mine = !!person;
  const whose = mine ? person : 'the studio';

  return (
    <div className="wrap">
      {/* The lede is set to 62ch and the controls were a full-width row under it,
          so the top of this screen was a paragraph beside a third of a metre of
          nothing, and then a bar of controls. They share the line now: the
          sentence keeps its measure, the filters take the space it was not
          using, and the first figure starts higher up the page. They still
          scope all three figures, which is why they sit above all three and not
          inside the first. */}
      <div className="numbers-head">
        <header className="detail-head">
          <button className="btn ghost tight" onClick={onBack}><ArrowLeft size={15} />All projects</button>
          <h1>The numbers</h1>
          <p className="lede">
            Every duration is counted in working days: Sundays are excluded, and a planned
            duration in weeks is read as six days to the week. Nothing here is inferred — a
            date nobody set is reported as missing, never guessed at.
          </p>
        </header>

        <div className="toolbar scoping">
          <select className="select" value={person ?? ''} onChange={(e) => setPerson(e.target.value)}
                  aria-label="Whose work to show">
            <option value="">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}{p === me ? ' (you)' : ''}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Filter by discipline">
            {TYPES.map(([v, l]) => (
              <button key={v || 'all'} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
            ))}
          </div>
          <span className="scope num">
            {model.rows.length} {model.rows.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
      </div>

      {behind && (
        <SchemaNotice what="Section deadlines are missing from the figures below until it is applied — the table that holds them does not exist yet." />
      )}

      <div className="tiles">
        <Tile n={model.head.overdue} label="Deadlines already missed" tone={model.head.overdue ? 'late' : null}
              note={mine ? `on ${person}'s projects` : 'across the studio'} />
        <Tile n={model.head.soon} label="Due in the next four weeks"
              note="working days, Sundays excluded" />
        <Tile n={model.head.runningUndated} label="Running with no date on it"
              tone={model.head.runningUndated ? 'late' : null}
              note={`of ${model.head.running} stages under way`} />
        <Tile n={model.head.live} label="Live projects" note={mine ? `${whose} owns work on these` : 'in view'} />
      </div>

      <div className="figs one">
        {/* ------------------------------------------------- 1. the snapshot */}
        <Figure
          title={mine ? `${person}'s deadlines` : 'Deadlines across the studio'}
          claim="Every date anybody has committed to on these projects — a project's delivery, a section's deadline, a single stage's target — soonest first, with the ones already missed at the top. Working days, so a date two Sundays away is twelve days off, not fourteen."
          columns={['When', 'What', 'Project', 'Working days']}
          rows={model.items.map((i) => [
            shortDate(i.date), i.what, i.project, i.days,
          ])}
          empty={
            model.rows.length === 0
              ? 'No projects in view.'
              : 'Not one date has been set on these projects — not a delivery date, not a section deadline, not a stage target. That is not an empty diary; it is an unwritten one. The figure below counts what is waiting for a date.'
          }
        >
          <table className="dates">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Project</th>
              </tr>
            </thead>
            <tbody>
              {model.items.slice(0, 14).map((i) => (
                <tr key={i.key} className={i.days < 0 ? 'late' : undefined}>
                  <td className="when">
                    {shortDate(i.date)}
                    <span className="rel">{dueWording(i.days)}</span>
                  </td>
                  <td>
                    <span className="what">{i.what}</span>
                    <span className="where">
                      <span className={`kind k-${i.kind}`}>{KIND[i.kind]}</span>
                      {i.section && ` · ${i.section}`}
                      {i.status && ` · ${statusLabel(i.status)}`}
                    </span>
                  </td>
                  <td>{i.project}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.items.length > 14 && (
            <p className="figfoot">
              <Calendar size={12} />
              Showing the 14 nearest of {model.items.length}. “Numbers” lists them all.
            </p>
          )}
        </Figure>

        {/* ------------------------------------------- 2. dated and undated */}
        <Figure
          title="What has a date, and what does not"
          claim="Every unfinished stage in scope, split by whether the work has begun and whether anything holds it to a date — its own target, or a deadline on its section. The left of each bar is work in flight; the red at the very left is the part nothing is holding to a date, and it is the only part that needs acting on today."
          columns={['Section', 'Running, no date', 'Running, dated',
                    'Not started, no date', 'Not started, dated', 'Total']}
          rows={model.coverage.filter((d) => d.value > 0).map((d) => [
            d.label, d.runningUndated, d.runningDated,
            d.notStartedUndated, d.notStartedDated, d.value,
          ])}
          empty="No unfinished stages are in scope in this view."
        >
          <StackedBars
            data={model.coverage}
            unit="stages"
            parts={UNDATED_PARTS}
          />
          <p className="figfoot">
            <Dashed size={12} />
            Most of the not-started total is structure the studio has not reached yet, which is
            normal and not a backlog. A stage counts as dated if its section carries a deadline,
            even without a target of its own.
          </p>
        </Figure>

        {/* ------------------------------------------------- 3. the team */}
        <Figure
          title="Team load"
          claim="Live projects where a person owns work. Advisory involvement is excluded: it owns no work, and counting it would put the principal at the top of a load chart he is not carrying. These are the same counts the original spreadsheet carried."
          columns={['Person', 'Live projects']}
          rows={model.team.map((d) => [d.label, d.value])}
          empty="Nobody is assigned to a live project in this view."
        >
          {/* Folded into two columns, and shorter rows. One bar per person down
              a 1100px card was a screenful of saturated fill for eight numbers,
              none of them above 15; the same eight now sit in four rows without
              losing the shared scale, the rank order or a single direct label. */}
          <Bars data={model.team} unit="live projects" color="var(--series-4)"
                labelWidth={108} valueWidth={34} rowHeight={26} columns={2} />
          <p className="figfoot">
            <Users size={12} />
            One project counts once per person, whatever their role code on it.
          </p>
        </Figure>
      </div>

      <p className="foot">
        <Check size={13} />
        {model.head.dated} dated {model.head.dated === 1 ? 'commitment' : 'commitments'} across
        {' '}{model.rows.length} {model.rows.length === 1 ? 'project' : 'projects'}, holding
        {' '}{model.head.totalPending - model.head.totalUndated} of
        {' '}{model.head.totalPending} unfinished stages to a date.
      </p>
    </div>
  );
}
