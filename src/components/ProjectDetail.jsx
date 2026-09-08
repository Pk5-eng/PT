import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { STATUSES, statusLabel, substageMeta, dateTime, shortDate } from '../lib/format.js';

/**
 * Deliverable checklist for one substage. Rows in project_deliverable are
 * created on first tick: the taxonomy lists every drawing a substage can
 * produce, but a project only acquires a row once someone says something about
 * it. done_on is stamped by the database, never sent from here.
 */
function Deliverables({ projectId, list, state, onChange }) {
  if (list.length === 0) {
    return <p className="empty">No deliverables listed for this substage.</p>;
  }
  return (
    <ul className="deliverables">
      {list.map((d) => {
        const row = state[d.id];
        const done = !!row?.done;
        return (
          <li key={d.id}>
            <label>
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => onChange(d.id, e.target.checked)}
              />
              <span className={done ? 'ticked' : undefined}>{d.name}</span>
              {done && row?.done_on && <span className="when">{shortDate(row.done_on)}</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default function ProjectDetail({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [rows, setRows] = useState([]);
  const [deliverables, setDeliverables] = useState({});   // substage_id -> [deliverable]
  const [ticks, setTicks] = useState({});                 // deliverable_id -> row
  const [events, setEvents] = useState([]);
  const [block, setBlock] = useState(null);
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [p, ps, dl, pd, ev, bl] = await Promise.all([
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
    ]);

    const failed = [p, ps, dl, pd, ev, bl].find((r) => r.error);
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
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(row, status) {
    setSaving(row.id);
    setError(null);
    // The dropdown is the entire editing interaction. The database stamps the
    // dates and writes the event; nothing about either is sent from here.
    const { error } = await supabase.from('project_substage').update({ status }).eq('id', row.id);
    if (error) setError(error.message);
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
  }

  if (error && !project) return <div className="state">Could not load this project: {error}</div>;
  if (!project) return <div className="state">Loading…</div>;

  // Flat list grouped by stage group, exactly as the spec asks.
  const groups = [];
  for (const r of rows) {
    const g = r.substages.stage_groups;
    if (!groups.length || groups[groups.length - 1].id !== g.id) groups.push({ id: g.id, name: g.name, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  const subName = (id) => rows.find((r) => r.substage_id === id)?.substages.name ?? 'a substage';

  return (
    <div className="wrap">
      <button className="clear back" onClick={onBack}>← All projects</button>

      <header className="detail-head">
        <h1>{project.name}</h1>
        <div className="pmeta">
          {project.type}
          {project.code ? ` · ${project.code}` : ''}
          {project.client_name ? ` · ${project.client_name}` : ''}
          {` · ${project.status}`}
          {project.priority != null ? ` · priority ${project.priority}` : ''}
          {project.site_location ? ` · ${project.site_location}` : ''}
        </div>
      </header>

      {block && (
        <div className="banner">
          <strong>Blocked by {block.owner}</strong> — {block.reason}
          <span className="when">raised {shortDate(block.raised_on)}</span>
        </div>
      )}

      {error && <p className="err inline">{error}</p>}

      {rows.length === 0 && (
        <p className="state">
          No substages are in scope for this project yet.
          <br /><small>It appears on the board as “No stages tracked”.</small>
        </p>
      )}

      {groups.map((g) => (
        <section key={g.id} className="group">
          <h2>{g.name}</h2>
          {g.rows.map((r) => {
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
                    title={list.length === 0 ? 'No deliverables' : 'Show deliverables'}
                  >
                    {list.length === 0 ? '·' : isOpen ? '▾' : '▸'}
                  </button>

                  <div className="sinfo">
                    <div className="sname">
                      {r.substages.name}
                      {list.length > 0 && (
                        <span className="more">{ticked}/{list.length}</span>
                      )}
                    </div>
                    {/* Status is stated in words, not only by colour. */}
                    <div className="smeta">
                      <strong>{statusLabel(r.status)}</strong> — {substageMeta({ ...r, planned_weeks: r.substages.planned_weeks })}
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
                  <Deliverables
                    projectId={projectId}
                    list={list}
                    state={ticks}
                    onChange={toggleDeliverable}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}

      <section className="group">
        <h2>Activity</h2>
        {events.length === 0 ? (
          <p className="empty">
            Nothing yet. Every status change from here on is recorded, with who made it and when.
          </p>
        ) : (
          <ul className="feed">
            {events.map((e) => (
              <li key={e.id}>
                <span className="who">{e.people?.name ?? 'Someone'}</span>
                {' moved '}
                <span className="what">{subName(e.substage_id)}</span>
                {' from '}{statusLabel(e.from_status)}{' to '}<strong>{statusLabel(e.to_status)}</strong>
                <span className="when">{dateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
