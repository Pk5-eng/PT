import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configError } from './lib/supabase.js';
import { sortRows, summarise } from './lib/board.js';
import Board from './components/Board.jsx';
import SignIn from './components/SignIn.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import { useRoute, toBoard } from './lib/route.js';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [rows, setRows] = useState(null);
  const [teams, setTeams] = useState({});
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const route = useRoute();
  const [person, setPerson] = useState('');
  const [type, setType] = useState('');

  useEffect(() => {
    if (configError) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    // Claim this user's `people` row so the trigger can attribute their status
    // changes. Harmless to call again on every load.
    await supabase.rpc('link_my_identity');

    const [board, assign] = await Promise.all([
      supabase.from('v_board').select('*'),
      supabase.from('assignments').select('project_id, role_code, people(name)'),
    ]);

    if (board.error) return setError(board.error.message);
    if (assign.error) return setError(assign.error.message);
    setError(null);

    const byProject = {};
    const names = new Set();
    for (const a of assign.data) {
      const name = a.people?.name;
      if (!name) continue;
      names.add(name);
      (byProject[a.project_id] ||= []).push({ name, role: a.role_code });
    }
    setTeams(byProject);
    setPeople([...names].sort());
    setRows(board.data);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session, load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (type) out = out.filter((r) => r.type === type);
    if (person) out = out.filter((r) => (teams[r.id] || []).some((t) => t.name === person));
    return sortRows(out);
  }, [rows, teams, person, type]);

  const totals = useMemo(() => summarise(filtered), [filtered]);

  if (configError) {
    return (
      <div className="state">
        <p><strong>Not configured</strong></p>
        <p style={{ maxWidth: 460, margin: '0 auto' }}>{configError}</p>
      </div>
    );
  }
  if (session === undefined) return <p className="state">Loading…</p>;
  if (!session) return <SignIn />;

  // Returning to the board refetches, so a status changed on the detail screen
  // is reflected in the row you came from.
  if (route.name === 'project') {
    return <ProjectDetail projectId={route.projectId} onBack={() => { toBoard(); load(); }} />;
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>Projects</h1>
        <span className="sub">
          {filtered.length}{filtered.length !== rows?.length ? ` of ${rows?.length}` : ''} shown
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="clear" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </span>
      </header>

      {error && (
        <p className="state">
          Could not load the board: {error}
          <br />
          <small>If this says permission denied, the RLS policies in <code>0003_rls.sql</code> may not be applied.</small>
        </p>
      )}

      {rows && (
        <>
          <div className="cards">
            <div className="card">
              <div className="n">{totals.live}</div>
              <div className="l">Live projects</div>
            </div>
            <div className={`card${totals.late ? ' warn' : ''}`}>
              <div className="n">{totals.late}</div>
              <div className="l">Past plan or target</div>
            </div>
            <div className={`card${totals.blocked ? ' warn' : ''}`}>
              <div className="n">{totals.blocked}</div>
              <div className="l">Blocked</div>
            </div>
          </div>

          <div className="filters">
            <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
              <option value="">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
              <option value="">All types</option>
              <option value="AR">AR — Architecture</option>
              <option value="ID">ID — Interior design</option>
              <option value="IR">IR — Interior renovation</option>
            </select>
            {(person || type) && (
              <button className="clear" onClick={() => { setPerson(''); setType(''); }}>Clear</button>
            )}
          </div>

          <Board rows={filtered} teams={teams} />
        </>
      )}

      {!rows && !error && <p className="state">Loading the board…</p>}
    </div>
  );
}
