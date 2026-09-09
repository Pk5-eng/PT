import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { PROJECT_STATUSES, ROLES } from '../lib/format.js';
import { X, Check, Alert, Users, Calendar, Plus } from './Icons.jsx';

/**
 * The panel that slides in from the right to create a project, and the same
 * panel reused to edit one.
 *
 * One component for both because the fields are the same fields and a studio of
 * ten should not have to learn two layouts. `project` null means create.
 *
 * WHAT THIS FORM IS ALLOWED TO WRITE
 *
 * A name, a discipline, a client, a team, and a delivery date. Not a start
 * date, not a conclusion date, not a duration: those are stamped by the
 * database when work actually moves (CLAUDE.md rule 2). The delivery date is
 * the exception for the same reason the substage target date is - it is a plan
 * someone is promising, and nothing but a person knows it.
 *
 * On create it also calls ensure_project_structure(), which is the same
 * function migration 0011 used to backfill the existing projects. A project
 * created here and a project that has been in the spreadsheet for two years end
 * up with identical structure, which is the whole point of putting that rule in
 * the database rather than in this file.
 */

const TYPES = [
  ['AR', 'AR', 'Architecture'],
  ['ID', 'ID', 'Interior design'],
  ['IR', 'IR', 'Interior renovation'],
];

const blank = () => ({
  name: '', type: 'AR', client_name: '', code: '', site_location: '',
  status: 'ongoing', priority: '', target_delivery: '',
});

export default function ProjectPanel({ open, project, people, team, onClose, onSaved }) {
  const editing = !!project;
  const [form, setForm] = useState(blank);
  const [members, setMembers] = useState({});     // person_id -> role_code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const panel = useRef(null);
  const firstField = useRef(null);

  // Reset every time the panel opens, so a cancelled edit never leaks into the
  // next one and a create never opens pre-filled with the last project.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(project
      ? {
          name: project.name ?? '',
          type: project.type ?? 'AR',
          client_name: project.client_name ?? '',
          code: project.code ?? '',
          site_location: project.site_location ?? '',
          status: project.status ?? 'ongoing',
          priority: project.priority ?? '',
          target_delivery: project.target_delivery ?? '',
        }
      : blank());
    setMembers(Object.fromEntries((team ?? []).map((t) => [t.person_id, t.role_code])));
    // Focus the first field: the panel is opened to type in, not to look at.
    const id = setTimeout(() => firstField.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open, project, team]);

  // Escape closes. Focus stays inside while it is open, because a panel that
  // lets Tab wander onto the board behind it is a panel you lose your place in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = panel.current?.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled])');
      if (!f || f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const toggleMember = (personId) =>
    setMembers((m) => {
      const next = { ...m };
      if (next[personId]) delete next[personId];
      else next[personId] = 'DD';           // the commonest role; changed in place
      return next;
    });

  const setRole = (personId, role) => setMembers((m) => ({ ...m, [personId]: role }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('A project needs a name.');
    setBusy(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      type: form.type,
      status: form.status,
      client_name: form.client_name.trim() || null,
      code: form.code.trim() || null,
      site_location: form.site_location.trim() || null,
      priority: form.priority === '' ? null : Number(form.priority),
      target_delivery: form.target_delivery || null,
    };

    let projectId = project?.id;

    if (editing) {
      const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
      if (error) { setBusy(false); return setError(error.message); }
    } else {
      const { data, error } = await supabase.from('projects').insert(payload).select('id').single();
      if (error) { setBusy(false); return setError(error.message); }
      projectId = data.id;
      // The full section structure, from the same database function the
      // backfill used. Failing here is worth saying out loud: the project
      // exists but has no stages, which the board would report as a gap rather
      // than silently.
      const { error: structErr } = await supabase.rpc('ensure_project_structure', { p_project_id: projectId });
      if (structErr) {
        setBusy(false);
        return setError(`Project saved, but its sections could not be created: ${structErr.message}`);
      }
    }

    // Assignments are replaced rather than diffed. There are at most ten people
    // and a delete-then-insert is one round trip each; a diff would be more
    // code for a result nobody can tell apart.
    const wanted = Object.entries(members);
    const del = await supabase.from('assignments').delete().eq('project_id', projectId);
    if (del.error) { setBusy(false); return setError(del.error.message); }
    if (wanted.length > 0) {
      const ins = await supabase.from('assignments').insert(
        wanted.map(([person_id, role_code]) => ({ project_id: projectId, person_id, role_code })));
      if (ins.error) { setBusy(false); return setError(ins.error.message); }
    }

    setBusy(false);
    onSaved(projectId, editing);
  }

  const chosen = Object.keys(members).length;

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`panel${open ? ' on' : ''}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${project.name}` : 'New project'}
        aria-hidden={!open}
        inert={open ? undefined : ''}
      >
        <form onSubmit={submit}>
          <header>
            <div>
              <h2>{editing ? 'Edit project' : 'New project'}</h2>
              <p>{editing
                ? 'Changing the discipline does not move existing stage data.'
                : 'Every section is created for you. Nothing is marked started.'}</p>
            </div>
            <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <div className="body">
            <label className="fld">
              <span>Project name</span>
              <input ref={firstField} value={form.name} onChange={set('name')}
                     required maxLength={120} placeholder="e.g. Ashok Ranka" />
            </label>

            <div className="fld">
              <span>Discipline</span>
              <div className="seg wide" role="group" aria-label="Discipline">
                {TYPES.map(([v, short, long]) => (
                  <button key={v} type="button" aria-pressed={form.type === v}
                          onClick={() => setForm((f) => ({ ...f, type: v }))} title={long}>
                    <strong>{short}</strong><span className="sub">{long}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="two">
              <label className="fld">
                <span>Client</span>
                <input value={form.client_name} onChange={set('client_name')} maxLength={120} />
              </label>
              <label className="fld">
                <span>Code</span>
                <input value={form.code} onChange={set('code')} maxLength={40} />
              </label>
            </div>

            <label className="fld">
              <span><Calendar size={13} />Estimated delivery</span>
              <input type="date" value={form.target_delivery} onChange={set('target_delivery')}
                     min="2000-01-01" max="2099-12-31" />
              <em>
                When the whole project is expected to land. Section deadlines are
                set on the project screen. Counted in working days, Sundays excluded.
              </em>
            </label>

            <fieldset className="fld">
              <legend><Users size={13} />Team{chosen > 0 && <span className="count num">{chosen}</span>}</legend>
              <ul className="picklist">
                {people.map((p) => {
                  const on = !!members[p.id];
                  return (
                    <li key={p.id} className={on ? 'on' : undefined}>
                      <label>
                        <input type="checkbox" checked={on} onChange={() => toggleMember(p.id)} />
                        <span className="box"><Check size={11} /></span>
                        <span className="who">{p.name}</span>
                      </label>
                      {on && (
                        <select className="select sm" value={members[p.id]}
                                onChange={(e) => setRole(p.id, e.target.value)}
                                aria-label={`${p.name}'s role`}>
                          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
              {people.length === 0 && <p className="empty">No people are set up yet.</p>}
            </fieldset>

            {editing && (
              <div className="two">
                <label className="fld">
                  <span>Status</span>
                  <select className="select" value={form.status} onChange={set('status')}>
                    {PROJECT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="fld">
                  <span>Priority</span>
                  <select className="select" value={form.priority} onChange={set('priority')}>
                    <option value="">Not set</option>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            )}

            <label className="fld">
              <span>Site</span>
              <input value={form.site_location} onChange={set('site_location')} maxLength={160} />
            </label>

            {error && <p className="err inline"><Alert size={15} />{error}</p>}
          </div>

          <footer>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? <><Check size={15} />Save changes</> : <><Plus size={15} />Create project</>}
            </button>
          </footer>
        </form>
      </aside>
    </>
  );
}
