import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase.js';
import {
  STATUSES, statusLabel, substageMeta, dateTime, shortDate, relative,
  projectStatusLabel, dueWording,
} from '../lib/format.js';
import { workingDays, todayISO } from '../lib/workdays.js';
import { isCompleted } from '../lib/board.js';
import { daysSpent } from '../lib/analytics.js';
import ProjectPanel from './ProjectPanel.jsx';
import SchemaNotice from './SchemaNotice.jsx';
import { isSchemaBehind } from '../lib/schema.js';
import { optimistic, useRefreshOnReturn } from '../lib/live.js';
import {
  ArrowLeft, ChevronRight, Check, Alert, Activity, Layers, Users,
  Calendar, Pencil, Clock, LogOut, Undo,
} from './Icons.jsx';

/**
 * One project, read as sections.
 *
 * The screen is organised by stage group because that is how the studio talks
 * about a job - "we're in design development", not "we're in substage 3" - and
 * because a deadline is committed to at that level. Each section carries:
 *
 *   a deadline the studio sets,          project_stage_group.target_date
 *   its substages and their statuses,    project_substage
 *   the deliverables inside each one.    project_deliverable
 *
 * The one thing a person types here is a date that is a PLAN. started_on and
 * concluded_on stay stamped by the database on a status change and are never
 * editable, per CLAUDE.md rule 2. The distinction is the whole reason the old
 * spreadsheet had six dates in it: nobody types a date that records the past.
 */

/** Deliverable checklist for one substage. done_on is stamped by the database. */
function Deliverables({ list, state, onChange }) {
  if (list.length === 0) return null;
  return (
    <ul className="deliverables">
      {list.map((d) => {
        const row = state[d.id];
        const done = !!row?.done;
        return (
          <li key={d.id}>
            <label>
              <input type="checkbox" checked={done} onChange={(e) => onChange(d.id, e.target.checked)} />
              <span className="box"><Check size={11} /></span>
              <span className={done ? 'ticked' : undefined}>{d.name}</span>
              {done && row?.done_on && <span className="when">{shortDate(row.done_on)}</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The status word, with the dot as a second signal. Never the dot alone. */
function Pill({ status }) {
  return (
    <span className={`pill p-${status}`}>
      <span className="dot" />{statusLabel(status)}
    </span>
  );
}

/**
 * A deadline for one section.
 *
 * Deliberately a plain date input rather than a picker of our own: it is the
 * one control every person here already knows, it is keyboard-accessible for
 * free, and on a phone it opens the platform calendar. Clearing it sets the
 * date to null rather than deleting the row, so a deadline that gets removed
 * and re-set does not churn rows.
 */
function SectionDeadline({ value, onChange, busy, disabled }) {
  const over = value ? workingDays(value, todayISO()) : null;
  const late = over != null && over > 0;
  if (disabled) {
    return (
      <span className="deadline off" title="Needs the pending database migration">
        <Calendar size={13} /><span className="rel none">deadlines unavailable</span>
      </span>
    );
  }
  return (
    <span className={`deadline${late ? ' over' : ''}${busy ? ' pending' : ''}`}>
      <Calendar size={13} />
      <label>
        <span className="vh">Section deadline</span>
        <input
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          min="2000-01-01"
          max="2099-12-31"
        />
      </label>
      {value
        ? <span className="rel">{late ? `${over} days over` : dueWording(-(over ?? 0))}</span>
        : <span className="rel none">no deadline</span>}
    </span>
  );
}

export default function ProjectDetail({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [rows, setRows] = useState([]);
  const [deliverables, setDeliverables] = useState({});   // substage_id -> [deliverable]
  const [ticks, setTicks] = useState({});                 // deliverable_id -> row
  const [events, setEvents] = useState([]);
  const [deadlines, setDeadlines] = useState({});         // stage_group_id -> row
  const [behind, setBehind] = useState(false);            // database older than this app
  const [team, setTeam] = useState([]);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(null);
  const [collapsed, setCollapsed] = useState({});         // stage_group_id -> true
  const [pending, setPending] = useState({});   // id -> a write is in flight
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const flashTimer = useRef(null);

  const say = useCallback((msg) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const load = useCallback(async () => {
    const [p, ps, dl, pd, ev, as, psg, pp] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase
        .from('project_substage')
        .select('id, status, started_on, concluded_on, target_date, substage_id, substages(id, name, seq, planned_weeks, stage_groups(id, name, seq))')
        .eq('project_id', projectId),
      supabase.from('deliverables').select('id, name, seq, substage_id').eq('active', true),
      supabase.from('project_deliverable').select('id, deliverable_id, done, done_on').eq('project_id', projectId),
      supabase
        .from('events')
        .select('id, from_status, to_status, at, substage_id, people(name)')
        .eq('project_id', projectId)
        .order('at', { ascending: false })
        .limit(50),
      supabase.from('assignments').select('person_id, role_code, people(name)').eq('project_id', projectId),
      supabase.from('project_stage_group').select('id, stage_group_id, target_date').eq('project_id', projectId),
      supabase.from('people').select('id, name').eq('active', true).order('name'),
    ]);

    // Section deadlines are additive: they arrived in migration 0009, and a
    // database that has not had it applied yet is a normal state for this
    // architecture, not a broken one. So psg is NOT in the fatal list. Losing
    // it costs the deadline controls and nothing else, and the banner says so
    // rather than letting the feature vanish without explanation.
    const behindNow = isSchemaBehind(psg.error);
    setBehind(behindNow);

    const failed = [p, ps, dl, pd, ev, as, pp].find((r) => r.error)
      ?? (behindNow ? null : (psg.error ? psg : null));
    if (failed) return setError(failed.error.message);
    setError(null);

    setProject(p.data);

    // Stage order is load-bearing: it is how the studio reads a project.
    const sorted = [...ps.data].sort((a, b) => {
      const ga = a.substages.stage_groups.seq, gb = b.substages.stage_groups.seq;
      return ga !== gb ? ga - gb : a.substages.seq - b.substages.seq;
    });
    setRows(sorted);

    const byS = {};
    for (const d of dl.data) (byS[d.substage_id] ||= []).push(d);
    for (const k of Object.keys(byS)) byS[k].sort((a, b) => a.seq - b.seq);
    setDeliverables(byS);

    setTicks(Object.fromEntries(pd.data.map((r) => [r.deliverable_id, r])));
    setEvents(ev.data);
    setDeadlines(Object.fromEntries((psg.data ?? []).map((r) => [r.stage_group_id, r])));
    setTeam(as.data.map((a) => ({
      person_id: a.person_id, name: a.people?.name, role_code: a.role_code, role: a.role_code,
    })).filter((t) => t.name));
    setPeople(pp.data);

    // A section where nothing is in scope is closed on arrival. It is still
    // listed, and still one click from open: hiding it would be the spreadsheet
    // mistake of pretending a decision was never made.
    setCollapsed((c) => {
      if (Object.keys(c).length) return c;
      const shut = {};
      const groups = new Map();
      for (const r of sorted) {
        const gid = r.substages.stage_groups.id;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(r);
      }
      for (const [gid, list] of groups) {
        if (list.every((r) => r.status === 'not_in_scope')) shut[gid] = true;
      }
      return shut;
    });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // A screen left open all afternoon is refreshed when its person comes back to
  // it - never while the edit panel is open or a write is in flight, because a
  // refresh replaces the state those are sitting on top of.
  const busy = editing || Object.keys(pending).length > 0;
  const markFresh = useRefreshOnReturn(load, { paused: busy });
  useEffect(() => { if (!busy) markFresh(); }, [rows, busy, markFresh]);

  /** Patch one substage row in place. Keeps its nested substages/stage_groups. */
  const patchRow = useCallback((id, fields) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r)));
  }, []);

  const mark = useCallback((key, on) => {
    setPending((p) => {
      if (!on) { const { [key]: _drop, ...rest } = p; return rest; }
      return { ...p, [key]: true };
    });
  }, []);

  /**
   * The activity feed after a status change. Not awaited by the thing that
   * triggered it: the row on screen is already correct, and the feed catching
   * up a moment later costs the user nothing.
   */
  const refreshEvents = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('id, from_status, to_status, at, substage_id, people(name)')
      .eq('project_id', projectId)
      .order('at', { ascending: false })
      .limit(50);
    if (data) setEvents(data);
  }, [projectId]);

  /**
   * The dropdown is the entire editing interaction, so it has to feel like one.
   *
   * The row moves the moment you choose, and the database's answer replaces the
   * guess when it arrives - the trigger stamps started_on and concluded_on, and
   * those come back in the returned row rather than being predicted here. If
   * the write is refused the row goes back to what it was and says why.
   */
  async function changeStatus(row, status) {
    const before = {
      status: row.status, started_on: row.started_on, concluded_on: row.concluded_on,
    };
    setError(null);
    mark(row.id, true);

    await optimistic({
      apply: () => patchRow(row.id, { status }),
      revert: () => patchRow(row.id, before),
      send: () => supabase
        .from('project_substage')
        .update({ status })
        .eq('id', row.id)
        .select('id, status, started_on, concluded_on, target_date')
        .single(),
      settle: (data) => {
        patchRow(row.id, data);
        say(`${row.substages.name} — ${statusLabel(status)}`);
        refreshEvents();
      },
      onError: (e) => setError(`Could not change ${row.substages.name}: ${e.message}`),
    });

    mark(row.id, false);
  }

  /** The substage-level target date. A plan, so it is authorable; see 0004. */
  async function setTargetDate(row, date) {
    const before = { target_date: row.target_date };
    setError(null);
    mark(row.id, true);

    await optimistic({
      apply: () => patchRow(row.id, { target_date: date }),
      revert: () => patchRow(row.id, before),
      send: () => supabase
        .from('project_substage').update({ target_date: date }).eq('id', row.id)
        .select('id, target_date').single(),
      settle: (data) => {
        patchRow(row.id, data);
        say(date ? `Target set for ${row.substages.name}` : 'Target cleared');
      },
      onError: (e) => setError(`Could not set that target date: ${e.message}`),
    });

    mark(row.id, false);
  }

  async function setSectionDeadline(groupId, date) {
    const before = deadlines[groupId] ?? null;
    setError(null);
    mark(groupId, true);

    await optimistic({
      apply: () => setDeadlines((d) => ({ ...d, [groupId]: { ...d[groupId], target_date: date } })),
      revert: () => setDeadlines((d) => ({ ...d, [groupId]: before })),
      send: () => supabase
        .from('project_stage_group')
        .upsert({ project_id: projectId, stage_group_id: groupId, target_date: date },
                { onConflict: 'project_id,stage_group_id' })
        .select('id, stage_group_id, target_date')
        .single(),
      settle: (data) => {
        setDeadlines((d) => ({ ...d, [groupId]: data }));
        say(date ? `Deadline set — ${shortDate(date)}` : 'Deadline cleared');
      },
      onError: (e) => {
        if (isSchemaBehind(e)) { setBehind(true); return; }
        setError(`Could not set that deadline: ${e.message}`);
      },
    });

    mark(groupId, false);
  }

  /**
   * Ticking a box is the smallest interaction in the app and used to be one of
   * the slowest: an upsert, then a refetch of every deliverable row on the
   * project. The tick now lands at once and only the one row it wrote comes
   * back. done_on is still the database's to decide - the optimistic state
   * leaves it alone rather than guessing today's date, and takes it from the
   * returned row.
   */
  async function toggleDeliverable(deliverableId, done) {
    const before = ticks[deliverableId] ?? null;
    setError(null);

    await optimistic({
      apply: () => setTicks((t) => ({ ...t, [deliverableId]: { ...t[deliverableId], done } })),
      revert: () => setTicks((t) => ({ ...t, [deliverableId]: before })),
      send: () => supabase
        .from('project_deliverable')
        .upsert({ project_id: projectId, deliverable_id: deliverableId, done },
                { onConflict: 'project_id,deliverable_id' })
        .select('id, deliverable_id, done, done_on')
        .single(),
      settle: (data) => {
        setTicks((t) => ({ ...t, [deliverableId]: data }));
        say(done ? 'Ticked' : 'Unticked');
      },
      onError: (e) => setError(`Could not save that tick: ${e.message}`),
    });
  }

  /**
   * Closing a project, and opening it again.
   *
   * ONE FIELD, AND ONLY THE ONE. `status` and nothing else, so a colleague who
   * is editing the client name in the panel at this moment does not lose it
   * (CLAUDE.md rule 9). The edit panel's status dropdown still exists and still
   * reaches all six values; this is the one the studio does ninety per cent of
   * the time, given its own button where the work actually ends.
   *
   * NOTHING ELSE IS TOUCHED. Not a substage status, not a deliverable tick, not
   * a date. Walking the stage list and marking everything done would write a
   * dozen events nobody performed and stamp concluded_on through the trigger on
   * work whose real conclusion nobody recorded - inventing history to make a
   * screen look tidy. A finished project keeps its stages exactly as the studio
   * left them, and the board says "Completed" rather than reading them.
   *
   * NO CONFIRM STEP. This is fully reversible, the reverse is one click in the
   * same place, and the result is stated on screen the instant it happens - so
   * a dialog would buy nothing and cost every person a click, on a tool whose
   * whole premise is that an interaction survives being done in thirty seconds.
   *
   * Reopening writes 'ongoing' rather than restoring whatever the status was
   * before, because nothing here knows that: a project completed from 'hold'
   * was on hold in April and is not necessarily on hold now. The button says
   * which value it writes, and the edit panel is one click away for the rest.
   */
  async function setProjectStatus(next) {
    const before = project.status;
    setError(null);
    mark('project', true);

    await optimistic({
      apply: () => setProject((p) => ({ ...p, status: next })),
      revert: () => setProject((p) => ({ ...p, status: before })),
      send: () => supabase
        .from('projects').update({ status: next }).eq('id', projectId)
        .select('id, status').single(),
      settle: (data) => {
        setProject((p) => ({ ...p, status: data.status }));
        say(data.status === 'completed' ? 'Project completed' : 'Project reopened');
      },
      onError: (e) => setError(`Could not change the project status: ${e.message}`),
    });

    mark('project', false);
  }

  // Flat list grouped by stage group, exactly as the spec asks.
  const groups = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const g = r.substages.stage_groups;
      if (!out.length || out[out.length - 1].id !== g.id) out.push({ id: g.id, name: g.name, seq: g.seq, rows: [] });
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [rows]);

  const spent = useMemo(() => daysSpent(rows.map((r) => ({
    started_on: r.started_on, concluded_on: r.concluded_on,
  }))), [rows]);

  if (error && !project) return <div className="state"><Alert size={26} /><strong>Could not load this project</strong>{error}</div>;
  if (!project) {
    return (
      <div className="wrap">
        <div style={{ paddingTop: 24 }}>
          <div className="skel" style={{ height: 26, width: 240, marginBottom: 10 }} />
          <div className="skel" style={{ height: 14, width: 160, marginBottom: 26 }} />
          {[...Array(5)].map((_, i) => <div key={i} className="skel" style={{ height: 52, marginBottom: 6 }} />)}
        </div>
      </div>
    );
  }

  const subName = (id) => rows.find((r) => r.substage_id === id)?.substages.name ?? 'a substage';
  const working = team.filter((t) => t.role !== 'INVOLVED');
  const advisory = team.filter((t) => t.role === 'INVOLVED');
  const deliveryIn = project.target_delivery ? workingDays(todayISO(), project.target_delivery) : null;
  const finished = isCompleted(project);

  return (
    <>
      <div className="appbar">
        <div className="inner">
          <button className="btn ghost" onClick={onBack} title="All projects" aria-label="All projects">
            <ArrowLeft size={15} /><span className="full">All projects</span>
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => setEditing(true)} title="Edit project" aria-label="Edit project">
            <Pencil size={15} /><span className="full">Edit project</span>
          </button>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}
                  title="Sign out" aria-label="Sign out">
            <LogOut size={15} /><span className="full">Sign out</span>
          </button>
        </div>
      </div>

      <div className="wrap">
        <header className={`detail-head hero t-${project.type}`}>
          <h1>{project.name}</h1>
          <div className="pmeta">
            <span className={`tag tag-${project.type}`}>{project.type}</span>
            {project.code && <span>{project.code}</span>}
            {project.client_name && <span>{project.client_name}</span>}
            {finished
              ? <span className="finished"><Check size={12} />Completed</span>
              : <span>{projectStatusLabel(project.status)}</span>}
            {project.priority != null && <span>priority {project.priority}</span>}
            {project.site_location && <span>{project.site_location}</span>}
          </div>

          <div className="herostats">
            <span className={`hs${deliveryIn != null && deliveryIn < 0 ? ' over' : ''}`}>
              <Calendar size={13} />
              {project.target_delivery
                ? <>Delivery <strong>{shortDate(project.target_delivery)}</strong> · {dueWording(deliveryIn)}</>
                : <>No delivery date set</>}
            </span>
            <span className="hs">
              <Clock size={13} />
              <strong>{spent}</strong> working days spent, Sundays excluded
            </span>
            {team.length > 0 && (
              <span className="hs">
                <Users size={13} />
                {working.length > 0 ? working.map((t) => `${t.name} (${t.role})`).join(', ') : 'nobody owns work here'}
                {advisory.length > 0 && ` · advisory: ${advisory.map((t) => t.name).join(', ')}`}
              </span>
            )}
          </div>
        </header>

        {behind && (
          <SchemaNotice what="Section deadlines are switched off until it is applied — the table that holds them does not exist yet." />
        )}

        {error && <p className="err inline"><Alert size={15} />{error}</p>}

        {rows.length === 0 && (
          <div className="state">
            <Layers size={26} />
            <strong>No sections are in scope yet</strong>
            <p>This project appears on the board as “No stages tracked”. Open <em>Edit project</em>
              and save it to build the standard sections.</p>
          </div>
        )}

        {groups.map((g) => {
          const shut = !!collapsed[g.id];
          const inScope = g.rows.filter((r) => r.status !== 'not_in_scope');
          const done = g.rows.filter((r) => r.status === 'done').length;
          const deadline = deadlines[g.id]?.target_date ?? null;
          return (
            <section key={g.id} className={`group sec sec-${Math.min(g.seq, 6) + 1}${inScope.length === 0 ? ' offscope' : ''}`}>
              <h2>
                <button onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !shut }))}
                        aria-expanded={!shut}>
                  <ChevronRight size={13} className={`chev${shut ? '' : ' open'}`} />
                  <span className="secname">{g.name}</span>
                  {/* A count, never a percentage: percent complete is always
                      back-derived from the fee stage and always fiction. */}
                  <span className="of">
                    {inScope.length === 0 ? 'not in scope' : `${done} of ${inScope.length} done`}
                  </span>
                </button>
                <SectionDeadline
                  value={deadline}
                  busy={!!pending[g.id]}
                  disabled={behind}
                  onChange={(date) => setSectionDeadline(g.id, date)}
                />
              </h2>

              {!shut && g.rows.map((r) => {
                const list = deliverables[r.substage_id] ?? [];
                const ticked = list.filter((d) => ticks[d.id]?.done).length;
                const isOpen = open === r.id;
                return (
                  <div key={r.id} className={`srow s-${r.status}`}>
                    <div className="sline">
                      <button
                        className="expand"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : r.id)}
                        aria-label={isOpen ? 'Hide details' : 'Show deliverables and target date'}
                        title={isOpen ? 'Hide details' : 'Deliverables and target date'}
                      >
                        <ChevronRight size={14} className={`chev${isOpen ? ' open' : ''}`} />
                      </button>

                      <div className="sinfo">
                        <div className="sname">
                          {r.substages.name}
                          {list.length > 0 && (
                            <span className="more" title={`${ticked} of ${list.length} deliverables ticked`}>
                              {ticked}/{list.length}
                            </span>
                          )}
                        </div>
                        {/* Status is stated in words, not only by colour. */}
                        <div className="smeta">
                          <Pill status={r.status} />
                          <span className="dates">
                            {substageMeta({ ...r, planned_weeks: r.substages.planned_weeks })}
                          </span>
                        </div>
                      </div>

                      <select
                        className={`statuspick${pending[r.id] ? ' pending' : ''}`}
                        value={r.status}
                        onChange={(e) => changeStatus(r, e.target.value)}
                        aria-label={`Status of ${r.substages.name}`}
                      >
                        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>

                    {isOpen && (
                      <div className="sdetail">
                        <label className="targetline">
                          <Calendar size={13} />
                          <span>Target date for this stage</span>
                          <input
                            type="date"
                            value={r.target_date ?? ''}
                            min="2000-01-01"
                            max="2099-12-31"
                            onChange={(e) => setTargetDate(r, e.target.value || null)}
                          />
                        </label>
                        {list.length > 0
                          ? <Deliverables list={list} state={ticks} onChange={toggleDeliverable} />
                          : <p className="empty">No deliverables are listed for this stage.</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}

        <section className="group">
          <h2><span className="secname"><Activity size={13} />Activity</span></h2>
          {events.length === 0 ? (
            <p className="empty">
              Nothing yet. Every status change from here on is recorded, with who made it and when.
            </p>
          ) : (
            <ul className="feed">
              {events.map((e) => (
                <li key={e.id}>
                  <Activity size={13} />
                  <div className="body">
                    <span className="who">{e.people?.name ?? 'Someone'}</span>
                    {' moved '}
                    <span className="what">{subName(e.substage_id)}</span>
                    {' from '}{statusLabel(e.from_status)}{' to '}<strong>{statusLabel(e.to_status)}</strong>
                  </div>
                  <span className="when" title={dateTime(e.at)}>{relative(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------------------------------- closing it out */}
        {/* Last thing on the page, because it is the last thing that happens to
            a project, and because a green button that removes a row from every
            live figure has no business sitting beside the controls people use
            forty times a day. Both states say what the click does to the rest
            of the app before it is clicked, not after. */}
        <section className={`closeout${finished ? ' on' : ''}`}>
          <div className="co-text">
            <strong>{finished ? 'This project is completed.' : 'Finished with this project?'}</strong>
            <p>
              {finished
                ? 'It sits at the bottom of the board in green, and is left out of the live '
                  + 'count, the overdue and delivery figures, and every figure on the numbers '
                  + 'screen. Its stages, dates and activity are untouched.'
                : 'Marking it completed moves it to the bottom of the board in green and takes '
                  + 'it out of the live count and the numbers screen. No stage is changed and '
                  + 'nothing is deleted — the button here puts it straight back.'}
            </p>
          </div>
          {finished ? (
            <button type="button" className="btn" disabled={!!pending.project}
                    onClick={() => setProjectStatus('ongoing')}>
              <Undo size={15} />Reopen as ongoing
            </button>
          ) : (
            <button type="button" className="btn finish" disabled={!!pending.project}
                    onClick={() => setProjectStatus('completed')}>
              <Check size={15} />Project completed
            </button>
          )}
        </section>
      </div>

      <ProjectPanel
        open={editing}
        project={project}
        people={people}
        team={team}
        onClose={() => setEditing(false)}
        onSaved={async () => { setEditing(false); await load(); say('Project saved'); }}
      />

      {flash && <div className="flash" role="status"><Check size={14} />{flash}</div>}
    </>
  );
}
