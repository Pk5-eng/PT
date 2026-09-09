import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Figure, Bars, Trend, Composition, Tile, Key } from './Charts.jsx';
import { projectStatusLabel } from '../lib/format.js';
import { plannedWorkingDays } from '../lib/workdays.js';
import {
  spendByProject, overdueByProject, sectionLoad, teamLoad,
  throughput, statusMix, headline, daysSpent,
} from '../lib/analytics.js';
import { Alert, ArrowLeft, Clock, Check, TrendIcon } from './Icons.jsx';

/**
 * The numbers screen.
 *
 * It answers five questions, in the order the studio asks them: how much work
 * is late, where the live work is sitting, who is carrying it, how much has
 * actually been spent on each project, and whether anything is coming out the
 * other end.
 *
 * SUNDAYS ARE NOT COUNTED anywhere on this screen. That was the explicit ask
 * and it is applied to the board too, so the two never disagree.
 *
 * NO PERCENT COMPLETE, and nothing derived from a fee stage. Every figure here
 * is a count of something that happened - a substage moved, a day elapsed, a
 * person assigned - and the append-only events table is what several of them
 * are read from, which is why it is append-only.
 *
 * The filters sit in one row above every figure and scope all of them at once.
 * A per-chart filter would let two figures on one screen describe two different
 * sets of projects, which is how a dashboard starts lying.
 */

const TYPES = [['', 'All'], ['AR', 'AR'], ['ID', 'ID'], ['IR', 'IR']];

const STATUS_ORDER = ['ongoing', 'hold', 'not_confirmed', 'npp', 'completed', 'cancelled'];

// Categorical slots, assigned in fixed order and never cycled. The ordering is
// what keeps neighbouring slots separable under colour-vision deficiency, so it
// is not cosmetic and must not be re-sorted to taste.
const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)',
];

export default function Analytics({ onBack }) {
  const [rows, setRows] = useState(null);
  const [subs, setSubs] = useState([]);
  const [teams, setTeams] = useState({});
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  const [type, setType] = useState('');
  const [person, setPerson] = useState('');

  const load = useCallback(async () => {
    const [board, ps, ev, as] = await Promise.all([
      supabase.from('v_board').select('*'),
      supabase
        .from('project_substage')
        .select('project_id, status, started_on, concluded_on, substages(name, planned_weeks, stage_groups(name, seq))'),
      // 2000 is comfortably more than the studio will generate in a decade and
      // stops one runaway import from making this screen unloadable.
      supabase.from('events').select('to_status, at').order('at', { ascending: false }).limit(2000),
      supabase.from('assignments').select('project_id, role_code, people(id, name)'),
    ]);

    const failed = [board, ps, ev, as].find((r) => r.error);
    if (failed) return setError(failed.error.message);
    setError(null);

    setRows(board.data);
    setSubs(ps.data.map((r) => ({
      project_id: r.project_id,
      status: r.status,
      started_on: r.started_on,
      concluded_on: r.concluded_on,
      planned_weeks: r.substages?.planned_weeks ?? null,
      substage: r.substages?.name ?? null,
      section: r.substages?.stage_groups?.name ?? null,
      section_seq: r.substages?.stage_groups?.seq ?? 99,
    })));
    setEvents(ev.data);

    const byProject = {};
    for (const a of as.data) {
      if (!a.people?.name) continue;
      (byProject[a.project_id] ||= []).push({ name: a.people.name, role: a.role_code });
    }
    setTeams(byProject);
  }, []);

  useEffect(() => { load(); }, [load]);

  const people = useMemo(
    () => [...new Set(Object.values(teams).flat().map((t) => t.name))].sort(),
    [teams]);

  // One filtered set, derived once, feeding every figure below.
  const scoped = useMemo(() => {
    if (!rows) return null;
    const keep = rows.filter((r) =>
      (!type || r.type === type) &&
      (!person || (teams[r.id] ?? []).some((t) => t.name === person)));
    const ids = new Set(keep.map((r) => r.id));
    return {
      rows: keep,
      subs: subs.filter((s) => ids.has(s.project_id)),
      teams: Object.fromEntries(Object.entries(teams).filter(([id]) => ids.has(id))),
    };
  }, [rows, subs, teams, type, person]);

  const model = useMemo(() => {
    if (!scoped) return null;
    const subsByProject = {};
    for (const s of scoped.subs) (subsByProject[s.project_id] ||= []).push(s);

    const sections = [...new Map(
      subs.map((s) => [s.section, s.section_seq]))
    ].filter(([n]) => n).sort((a, b) => a[1] - b[1]).map(([n]) => n);

    // Planned working days for a project: the sum of the plans of the sections
    // it is actually running. Only shown where every running substage has a
    // plan, because a partial plan compared against a full elapsed figure would
    // read as being comfortably inside a budget that was never set.
    const planFor = (id) => {
      const list = (subsByProject[id] ?? []).filter((s) => s.started_on);
      if (list.length === 0 || list.some((s) => s.planned_weeks == null)) return null;
      return list.reduce((n, s) => n + plannedWorkingDays(s.planned_weeks), 0);
    };

    const spend = spendByProject(scoped.rows, subsByProject).map((d) => ({ ...d, plan: planFor(d.id) }));

    return {
      head: headline(scoped.rows, scoped.subs, events),
      spend,
      overdue: overdueByProject(scoped.rows),
      sections: sectionLoad(scoped.subs, sections),
      team: teamLoad(scoped.teams, scoped.rows),
      months: throughput(events, 12),
      mix: statusMix(scoped.rows, STATUS_ORDER),
      totalSpend: daysSpent(scoped.subs),
    };
  }, [scoped, subs, events]);

  if (error) {
    return <div className="state"><Alert size={26} /><strong>Could not load the numbers</strong>{error}</div>;
  }
  if (!model) {
    return (
      <div className="wrap">
        <div style={{ paddingTop: 24 }}>
          <div className="skel" style={{ height: 26, width: 220, marginBottom: 18 }} />
          {[...Array(4)].map((_, i) => <div key={i} className="skel" style={{ height: 132, marginBottom: 12 }} />)}
        </div>
      </div>
    );
  }

  const filtering = !!(type || person);

  return (
    <div className="wrap">
      <header className="detail-head">
        <button className="btn ghost tight" onClick={onBack}><ArrowLeft size={15} />All projects</button>
        <h1>The numbers</h1>
        <p className="lede">
          Every duration below is counted in working days: Sundays are excluded, and a
          planned duration in weeks is read as six days to the week, not seven.
        </p>
      </header>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by discipline">
          {TYPES.map(([v, l]) => (
            <button key={v || 'all'} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
          ))}
        </div>
        <select className="select" value={person} onChange={(e) => setPerson(e.target.value)}
                aria-label="Filter by person">
          <option value="">Anyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {filtering && (
          <button className="btn ghost" onClick={() => { setType(''); setPerson(''); }}>
            Clear · showing {scoped.rows.length} of {rows.length}
          </button>
        )}
      </div>

      <div className="tiles">
        <Tile n={model.head.live} label="Live projects" note={`${scoped.rows.length} in view`} />
        <Tile n={model.head.late} label="Past plan or deadline" tone={model.head.late ? 'late' : null}
              note={model.head.late ? 'sorted to the top of the board' : 'nothing overdue'} />
        <Tile n={model.head.medianAge ?? '—'} label="Median days in a running stage"
              note={`across ${model.head.running} running stages`} />
        <Tile n={model.head.concluded30} label="Stages concluded, last 30 days"
              note="from the activity log" tone={model.head.concluded30 ? 'good' : null} />
      </div>

      <div className="figs">
        <Figure
          title="Furthest past plan or deadline"
          claim="Working days a project has run past the planned duration of its most overdue stage, or past the date set for it. This is the board's sort order, as a picture."
          columns={['Project', 'Days over']}
          rows={model.overdue.map((d) => [d.label, d.value])}
          empty="Nothing is past its plan or its deadline. That is the good outcome, not a missing chart."
        >
          <Bars data={model.overdue} unit="working days" color="var(--status-critical)"
                highlight={() => true} />
          <p className="figfoot">
            <Alert size={12} />
            Each bar is one project, labelled with its overrun. Red here means late, and the
            number beside every bar says so in words as well.
          </p>
        </Figure>

        <Figure
          title="Working days spent, by project"
          claim="Every stage's elapsed time added up, Sundays excluded. Stages run in parallel here, so this is effort across the project, not how long the project has been open."
          columns={['Project', 'Days spent', 'Planned']}
          rows={model.spend.map((d) => [d.label, d.value, d.plan ?? '—'])}
          empty="No stage has a start date yet, so nothing has measurable time against it."
        >
          <Bars data={model.spend} unit="working days"
                mark={(d) => d.plan}
                highlight={(d) => d.plan != null && d.value > d.plan} />
          {/* Two colours means two things, so they are named. Without this a
              reader would take blue for "fine" when it also means "no plan was
              ever recorded", which is not the same claim at all. */}
          <Key items={[
            { label: 'past its planned duration', color: 'var(--status-critical)' },
            { label: 'within plan, or no plan recorded', color: 'var(--series-1)' },
          ]} />
          <p className="figfoot">
            <Clock size={12} />
            The thin tick on a bar is the planned duration of the stages that have started.
            It is shown only where every one of them has a plan; where it is missing, the
            plan was never recorded rather than being met.
          </p>
        </Figure>

        <Figure
          title="Where the live work is sitting"
          claim="Stages currently in process, by section. Counted on stages rather than projects, because a project can be running work in three sections at once."
          columns={['Section', 'Stages in process']}
          rows={model.sections.map((d) => [d.label, d.value])}
          empty="Nothing is in process."
        >
          <Bars data={model.sections} unit="stages" color="var(--series-3)" labelWidth={200} />
        </Figure>

        <Figure
          title="Team load"
          claim="Live projects where a person owns work. Advisory involvement is excluded: it owns no work, and counting it would put the principal at the top of a load chart he is not carrying."
          columns={['Person', 'Live projects']}
          rows={model.team.map((d) => [d.label, d.value])}
          empty="Nobody is assigned to a live project in this view."
        >
          <Bars data={model.team} unit="live projects" color="var(--series-4)" />
        </Figure>

        <Figure
          title="Stages concluded per month"
          claim="From the append-only activity log, so it is a record of what was actually called finished. Empty months are kept: a gap in output is a fact, and skipping the month would draw a line straight over it."
          columns={['Month', 'Stages concluded']}
          rows={model.months.map((d) => [d.label, d.value])}
          empty="No stage has been concluded in the app yet."
        >
          <Trend data={model.months} unit="stages concluded" />
          <p className="figfoot">
            <TrendIcon size={12} />
            Only changes made in this app appear here. Work concluded before the studio
            moved off the spreadsheet has no event behind it and is not counted.
          </p>
        </Figure>

        <Figure
          title="Projects by status"
          claim="The whole portfolio in one bar, in the order the statuses are worth reading."
          columns={['Status', 'Projects']}
          rows={model.mix.map((d) => [projectStatusLabel(d.label), d.value])}
          empty="No projects in view."
        >
          {model.mix.length < 2 ? (
            <p className="oneline">
              All {scoped.rows.length} projects in view are
              {' '}<strong>{projectStatusLabel(model.mix[0]?.label)}</strong>. A bar with one
              segment in it is a sentence, so this is the sentence.
            </p>
          ) : (
            <Composition
              data={model.mix.map((d) => ({ ...d, label: projectStatusLabel(d.label) }))}
              colors={SERIES}
              total={scoped.rows.length}
            />
          )}
        </Figure>
      </div>

      <p className="foot">
        <Check size={13} />
        {model.totalSpend} working days recorded across {scoped.rows.length} projects
        {filtering ? ' in this view' : ''}. Click a project on the board to see where they went.
      </p>
    </div>
  );
}
