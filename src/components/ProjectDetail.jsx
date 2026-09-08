import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { STATUSES, statusLabel, substageMeta, dateTime, shortDate, relative } from '../lib/format.js';
import { ArrowLeft, ChevronRight, Ban, Check, Alert, Activity, Layers, Users } from './Icons.jsx';

/**
 * Deliverable checklist for one substage. Rows in project_deliverable are
 * created on first tick: the taxonomy lists every drawing a substage can
 * produce, but a project only acquires a row once someone says something about
 * it. done_on is stamped by the database, never sent from here.
 */
function Deliverables({ list, state, onChange }) {
  if (list.length === 0) {
    return <p className="empty" style={{ margin: '0 12px 12px 48px' }}>No deliverables listed for this substage.</p>;
  }
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

export default function ProjectDetail({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [rows, setRows] = useState([]);
  const [deliverables, setDeliverables] = useState({});   // substage_id -> [deliverable]
  const [ticks, setTicks] = useState({});                 // deliverable_id -> row
  const [events, setEvents] = useState([]);
  const [block, setBlock] = useState(null);
  const [team, setTeam] = useState([]);
  const [open, setOpen] = useState(null);
  const [collapsed, setCollapsed] = useState({});         // stage_group_id -> true
  const [saving, setSaving] = useState(null);
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
    const [p, ps, dl, pd, ev, bl, as] = await Promise.all([
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
      supabase.from('blocks').select('*').eq('project_id', projectId).is('cleared_on', null).order('raised_on').limit(1),
      supabase.from('assignments').select('role_code, people(name)').eq('project_id', projectId),
    ]);

    const failed = [p, ps, dl, pd, ev, bl, as].find((r) => r.error);
    if (failed) return setError(failed.error.message);

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
    setBlock(bl.data[0] ?? null);
    setTeam(as.data.map((a) => ({ name: a.people?.name, role: a.role_code })).filter((t) => t.name));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(row, status) {
    setSaving(row.id);
    setError(null);
    // The dropdown is the entire editing interaction. The database stamps the
    // dates and writes the event; nothing about either is sent from here.
    const { error } = await supabase.from('project_substage').update({ status }).eq('id', row.id);
    if (error) setError(error.message);
    else say(`${row.substages.name} — ${statusLabel(status)}`);
    await load();
    setSaving(null);
  }

  async function toggleDeliverable(deliverableId, done) {
    setError(null);
    const { error } = await supabase
      .from('project_deliverable')
      .upsert({ project_id: projectId, deliverable_id: deliverableId, done },
              { onConflict: 'project_id,deliverable_id' });
    if (error) return setError(error.message);
    const { data } = await supabase
      .from('project_deliverable').select('id, deliverable_id, done, done_on').eq('project_id', projectId);
    setTicks(Object.fromEntries((data ?? []).map((r) => [r.deliverable_id, r])));
    say(done ? 'Ticked' : 'Unticked');
  }

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

  // Flat list grouped by stage group, exactly as the spec asks.
  const groups = [];
  for (const r of rows) {
    const g = r.substages.stage_groups;
    if (!groups.length || groups[groups.length - 1].id !== g.id) groups.push({ id: g.id, name: g.name, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  const subName = (id) => rows.find((r) => r.substage_id === id)?.substages.name ?? 'a substage';

  const working = team.filter((t) => t.role !== 'INVOLVED');
  const advisory = team.filter((t) => t.role === 'INVOLVED');

  return (
    <>
      <div className="appbar">
        <div className="inner">
          <button className="btn ghost" onClick={onBack}><ArrowLeft size={15} />All projects</button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      <div className="wrap">
        <header className="detail-head">
          <h1>{project.name}</h1>
          <div className="pmeta">
            <span className="tag">{project.type}</span>
            {project.code && <span>{project.code}</span>}
            {project.client_name && <span>{project.client_name}</span>}
            <span>{project.status.replace(/_/g, ' ')}</span>
            {project.priority != null && <span>priority {project.priority}</span>}
            {project.site_location && <span>{project.site_location}</span>}
          </div>
          {team.length > 0 && (
            <div className="pmeta" style={{ marginTop: 6 }}>
              <Users size={13} />
              <span>
                {working.length > 0 ? working.map((t) => `${t.name} (${t.role})`).join(', ') : 'nobody owns work here'}
                {advisory.length > 0 && ` · advisory: ${advisory.map((t) => t.name).join(', ')}`}
              </span>
            </div>
          )}
        </header>

        {block && (
          <div className="banner">
            <Ban size={16} />
            <div>
              <strong>Blocked by {block.owner}</strong> — {block.reason}
              <div className="when" style={{ marginLeft: 0 }}>raised {shortDate(block.raised_on)}</div>
            </div>
          </div>
        )}

        {error && <p className="err inline"><Alert size={15} />{error}</p>}

        {rows.length === 0 && (
          <div className="state">
            <Layers size={26} />
            <strong>No substages are in scope yet</strong>
            <p>This project appears on the board as “No stages tracked”, and stays there until
              someone decides which stages it should be measured against.</p>
          </div>
        )}

        {groups.map((g) => {
          const shut = !!collapsed[g.id];
          const done = g.rows.filter((r) => r.status === 'done').length;
          return (
            <section key={g.id} className="group">
              {/* A count, never a percentage: percent complete is always back-derived
                  from the fee stage and always fiction (CLAUDE.md). */}
              <h2>
                <button onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !shut }))}
                        aria-expanded={!shut}>
                  <ChevronRight size={13} className={`chev${shut ? '' : ' open'}`} />
                  {g.name}
                  <span className="rule" />
                  <span className="of">{done} of {g.rows.length} done</span>
                </button>
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
                        disabled={list.length === 0}
                        aria-label={list.length === 0 ? 'No deliverables' : 'Show deliverables'}
                        title={list.length === 0 ? 'No deliverables' : 'Show deliverables'}
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
                        className="statuspick"
                        value={r.status}
                        disabled={saving === r.id}
                        onChange={(e) => changeStatus(r, e.target.value)}
                        aria-label={`Status of ${r.substages.name}`}
                      >
                        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>

                    {isOpen && (
                      <Deliverables list={list} state={ticks} onChange={toggleDeliverable} />
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}

        <section className="group">
          <h2><Activity size={13} />Activity<span className="rule" /></h2>
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
      </div>

      {flash && <div className="flash" role="status"><Check size={14} />{flash}</div>}
    </>
  );
}
