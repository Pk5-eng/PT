import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { optimistic } from '../lib/live.js';
import { changedFields } from '../lib/save.js';
import {
  cleanName, cleanEmail, nameProblem, emailProblem, rosterOrder, liveLoad, archiveWarning,
} from '../lib/roster.js';
import { X, Check, Alert, Users, UserPlus, Archive, Undo, Pencil } from './Icons.jsx';

/**
 * The studio roster: the panel that adds someone to the team and takes someone
 * off it.
 *
 * WHY IT IS ON THE BOARD RATHER THAN IN AN ADMIN SCREEN
 *
 * There is no admin screen, and until this existed there was no way to add a
 * colleague short of writing SQL - which meant the roster was maintained by
 * whoever was willing to open the Supabase console, which meant it was not
 * maintained. Somebody joins the practice on a Monday; putting them on a
 * project should not wait for that.
 *
 * WHAT "REMOVE" MEANS HERE
 *
 * active = false, and nothing else. It is not a delete: the database revokes
 * that privilege outright (migration 0013), because a person is referenced by
 * every assignment they hold and every event they stamped. And it deliberately
 * does not reach into their assignments either - "Selva has left" and "Selva
 * was never on Ashok Ranka" are different statements and only the first is
 * true. So the panel says how many live projects still list them, because the
 * person archiving needs to know what is left to hand over, and finding that
 * out a week later is the whole failure this replaces.
 *
 * WHAT IT CANNOT DO, BY DESIGN
 *
 * Grant admin. `role` is not writable from the browser by anybody, so nothing
 * on this screen can promote anyone; that stays in the SQL editor with the rest
 * of the taxonomy. An admin's own row is out of a member's reach too, since
 * archiving the studio's only admin would switch off the taxonomy for everyone
 * and would look exactly like tidying up.
 */

/** A refusal that comes back as "no rows" rather than as a message. */
const NO_ROWS = 'PGRST116';

const writeError = (error, fallback) =>
  error?.code === NO_ROWS
    ? fallback
    : (error?.message ?? 'The change did not save.');

/** One person: their name, whether they can be reached, and what they carry. */
function Person({ p, roster, load, me, canTouchAdmins, onArchive, onRestore, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: p.name, email: p.email ?? '' });
  const [problem, setProblem] = useState(null);

  const isMe = p.id === me;
  const locked = p.role === 'admin' && !canTouchAdmins;
  const warning = archiveWarning(p.name, load);

  const open = () => { setDraft({ name: p.name, email: p.email ?? '' }); setProblem(null); setEditing(true); };

  const save = async () => {
    const patch = changedFields(
      { name: p.name, email: p.email },
      { name: cleanName(draft.name), email: cleanEmail(draft.email) });
    if (Object.keys(patch).length === 0) return setEditing(false);
    // Checked against everyone but this person: renaming Selva to "Selva" is
    // not a clash with Selva.
    const others = roster.filter((x) => x.id !== p.id);
    const bad = ('name' in patch ? nameProblem(patch.name, others) : null)
             ?? ('email' in patch ? emailProblem(draft.email, roster, p.id) : null);
    if (bad) return setProblem(bad);
    const ok = await onSave(p, patch);
    if (ok) setEditing(false); else setProblem('That change did not save.');
  };

  if (editing) {
    return (
      <li className="rperson editing">
        <div className="rfields">
          <input value={draft.name} aria-label={`${p.name}'s name`} maxLength={80}
                 onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input value={draft.email} aria-label={`${p.name}'s email`} maxLength={120}
                 placeholder="email, for signing in" type="email"
                 onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
          {problem && <span className="rwhy err"><Alert size={12} />{problem}</span>}
        </div>
        <div className="racts">
          <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn sm" onClick={save} disabled={busy}>
            <Check size={13} />Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`rperson${p.active ? '' : ' gone'}`}>
      <div className="rwho">
        <span className="rname">{p.name}</span>
        <span className="rmeta">
          {p.role === 'admin' && <span className="rrole">Admin</span>}
          {isMe && <span className="rrole you">You</span>}
          {!p.active && <span className="rrole off">Removed</span>}
          <span className="rload">
            {p.active
              ? (load ? `${load} live ${load === 1 ? 'project' : 'projects'}` : 'No live projects')
              : (load ? `still on ${load} live ${load === 1 ? 'project' : 'projects'}` : 'off every live project')}
          </span>
          {p.email && <span className="remail">{p.email}</span>}
        </span>
      </div>

      <div className="racts">
        {p.active ? (
          <>
            <button type="button" className="btn ghost sm icon" onClick={open} disabled={locked || busy}
                    title={locked ? 'Only an admin can edit an admin' : `Edit ${p.name}`}
                    aria-label={`Edit ${p.name}`}>
              <Pencil size={13} />
            </button>
            <button type="button" className="btn ghost sm" disabled={locked || isMe || busy}
                    onClick={() => onArchive(p, warning)}
                    title={locked ? 'Only an admin can remove an admin'
                         : isMe ? 'You cannot remove yourself'
                         : warning ?? `Remove ${p.name} from the team`}>
              <Archive size={13} />Remove
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost sm" disabled={locked || busy}
                  onClick={() => onRestore(p)} title={`Put ${p.name} back on the team`}>
            <Undo size={13} />Restore
          </button>
        )}
      </div>
    </li>
  );
}

export default function TeamPanel({ open, onClose, onChanged }) {
  const [people, setPeople] = useState(null);
  const [load, setLoad] = useState(new Map());
  const [me, setMe] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState(null);
  const [note, setNote] = useState(null);

  const panel = useRef(null);
  const firstField = useRef(null);

  const load_ = useCallback(async () => {
    const { data: myId } = await supabase.rpc('link_my_identity');

    const [roster, assign, projects] = await Promise.all([
      // Archived people included on purpose: "who used to be here" is what
      // explains a name still sitting on a project.
      supabase.from('people').select('id, name, email, role, active').order('name'),
      supabase.from('assignments').select('project_id, person_id, role_code'),
      supabase.from('projects').select('id, status'),
    ]);
    if (roster.error) return setError(roster.error.message);
    setError(null);
    setPeople(roster.data);
    setMe(myId ?? null);
    setMyRole(roster.data.find((p) => p.id === myId)?.role ?? null);
    if (!assign.error && !projects.error) setLoad(liveLoad(assign.data, projects.data));
  }, []);

  useEffect(() => {
    if (!open) return;
    setProblem(null); setNote(null); setName(''); setEmail('');
    load_();
    const id = setTimeout(() => firstField.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open, load_]);

  // Escape closes, Tab stays inside. Same reasoning as the project panel: a
  // dialog you can Tab out of is one you lose your place in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = panel.current?.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), button:not([disabled])');
      if (!f || f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const ordered = useMemo(() => rosterOrder(people ?? []), [people]);
  const active = ordered.filter((p) => p.active);

  /* --------------------------------------------------------------- writes */
  /* All three go on screen before the database answers, and go back if it
     refuses (CLAUDE.md rule 8). Everything the database decides - the new id,
     the role it defaulted to - is read back off the returned row rather than
     predicted here. */

  async function add(e) {
    e.preventDefault();
    const n = cleanName(name);
    const bad = nameProblem(n, people) ?? emailProblem(email, people);
    if (bad) return setProblem(bad);

    setProblem(null);
    setBusy(true);
    const before = people;
    const provisional = { id: `pending:${n}`, name: n, email: cleanEmail(email), role: 'member', active: true };

    const row = await optimistic({
      apply: () => setPeople((ps) => [...ps, provisional]),
      revert: () => setPeople(before),
      send: () => supabase.from('people')
        .insert({ name: n, email: cleanEmail(email) })
        .select('id, name, email, role, active').single(),
      settle: (saved) => setPeople((ps) => ps.map((p) => (p.id === provisional.id ? saved : p))),
      onError: (err) => setProblem(writeError(err, 'That person could not be added.')),
    });
    setBusy(false);
    if (row) {
      setName(''); setEmail('');
      setNote(`${row.name} is on the team. Put them on a project from the project screen.`);
      firstField.current?.focus();
      onChanged?.();
    }
  }

  const setActive = async (p, value, said) => {
    setBusy(true);
    setProblem(null);
    const before = people;
    const ok = await optimistic({
      apply: () => setPeople((ps) => ps.map((x) => (x.id === p.id ? { ...x, active: value } : x))),
      revert: () => setPeople(before),
      send: () => supabase.from('people').update({ active: value }).eq('id', p.id)
        .select('id, name, email, role, active').single(),
      settle: (saved) => setPeople((ps) => ps.map((x) => (x.id === p.id ? saved : x))),
      onError: (err) => setProblem(writeError(err,
        `${p.name} could not be changed. Only an admin can edit an admin's row.`)),
    });
    setBusy(false);
    if (ok) { setNote(said); onChanged?.(); }
    return !!ok;
  };

  const archive = (p, warning) =>
    setActive(p, false, warning ?? `${p.name} is off the team. Their record and their history stay.`);

  const restore = (p) => setActive(p, true, `${p.name} is back on the team.`);

  const savePerson = async (p, patch) => {
    setBusy(true);
    setProblem(null);
    const before = people;
    const ok = await optimistic({
      apply: () => setPeople((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...patch } : x))),
      revert: () => setPeople(before),
      send: () => supabase.from('people').update(patch).eq('id', p.id)
        .select('id, name, email, role, active').single(),
      settle: (saved) => setPeople((ps) => ps.map((x) => (x.id === p.id ? saved : x))),
      onError: (err) => setProblem(writeError(err,
        `${p.name} could not be changed. Only an admin can edit an admin's row.`)),
    });
    setBusy(false);
    if (ok) { setNote(`${patch.name ?? p.name} saved.`); onChanged?.(); }
    return !!ok;
  };

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`panel${open ? ' on' : ''}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="The studio team"
        aria-hidden={!open}
        inert={open ? undefined : ''}
      >
        <header>
          <div>
            <h2>The team</h2>
            <p>
              {people
                ? `${active.length} on the team${ordered.length > active.length
                    ? `, ${ordered.length - active.length} removed` : ''}`
                : 'Everyone who can be put on a project.'}
            </p>
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="body">
          <form className="roster-add" onSubmit={add}>
            <div className="rrow">
              <input ref={firstField} value={name} maxLength={80} placeholder="Name"
                     aria-label="Name of the person to add"
                     onChange={(e) => { setName(e.target.value); setProblem(null); }} />
              <input value={email} maxLength={120} type="email" placeholder="Email (optional)"
                     aria-label="Their email, if they will sign in"
                     onChange={(e) => { setEmail(e.target.value); setProblem(null); }} />
              <button type="submit" className="btn primary" disabled={busy || !cleanName(name)}>
                <UserPlus size={15} />Add
              </button>
            </div>
            <em>
              The email is the address they sign in with, and is what connects their
              sign-in to their name on the board. It can be filled in later.
            </em>
          </form>

          {problem && <p className="err inline"><Alert size={15} />{problem}</p>}
          {note && !problem && <p className="saidso"><Check size={14} />{note}</p>}
          {error && <p className="err inline"><Alert size={15} />Could not load the team: {error}</p>}

          {!people && !error && (
            <div className="skel" style={{ height: 180 }} />
          )}

          {people && (
            <ul className="roster">
              {ordered.map((p) => (
                <Person
                  key={p.id}
                  p={p}
                  roster={ordered}
                  load={load.get(p.id) ?? 0}
                  me={me}
                  canTouchAdmins={myRole === 'admin'}
                  busy={busy}
                  onArchive={archive}
                  onRestore={restore}
                  onSave={savePerson}
                />
              ))}
            </ul>
          )}

          <p className="figfoot">
            <Users size={12} />
            Removing someone never deletes them: their name stays on the projects
            they worked on, and on everything they moved. Nothing on this screen
            grants admin — that stays in the SQL editor, with the rest of the taxonomy.
          </p>
        </div>

        <footer>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </footer>
      </aside>
    </>
  );
}
