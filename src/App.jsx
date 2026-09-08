import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, configError } from './lib/supabase.js';
import { sortRows, summarise, matches, FOCUS } from './lib/board.js';
import Board from './components/Board.jsx';
import SignIn from './components/SignIn.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';
import { useRoute, toBoard } from './lib/route.js';
import { Search, X, Alert, Ban, Folder, Dashed, LogOut, Inbox } from './components/Icons.jsx';

const TYPES = [
  ['', 'All'],
  ['AR', 'AR'],
  ['ID', 'ID'],
  ['IR', 'IR'],
];

/**
 * The four numbers at the top are also the four filters. Reading "6 past plan"
 * and then having to build that filter by hand is the kind of small friction
 * that stops a tool being used; clicking the number is the whole interaction.
 * Exactly one can be on at a time, so the board is never quietly filtered by
 * two things at once.
 */
function Cards({ totals, focus, setFocus }) {
  const cards = [
    { key: 'live', n: totals.live, label: 'Live projects', Icon: Folder },
    { key: 'late', n: totals.late, label: 'Past plan or target', Icon: Alert, warn: true },
    { key: 'blocked', n: totals.blocked, label: 'Blocked', Icon: Ban, warn: true },
    { key: 'untracked', n: totals.untracked, label: 'No stages tracked', Icon: Dashed },
  ];
  return (
    <div className="cards">
      {cards.map(({ key, n, label, Icon, warn }) => {
        const on = focus === key;
        return (
          <button
            key={key}
            type="button"
            className={`card${warn && n > 0 ? ' warn' : ''}`}
            aria-pressed={on}
            onClick={() => setFocus(on ? null : key)}
            title={on ? 'Show all projects again' : `Show only these ${n}`}
          >
            {on && <span className="on">Filtering</span>}
            <div className="n num">{n}</div>
            <div className="l"><Icon size={13} />{label}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [rows, setRows] = useState(null);
  const [teams, setTeams] = useState({});
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const route = useRoute();

  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [type, setType] = useState('');
  const [focus, setFocus] = useState(null);
  const [sort, setSort] = useState('overrun');
  const searchRef = useRef(null);

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

  // "/" focuses search, Escape clears it. Both are muscle memory from every
  // other tool these people use, and neither needs to be discovered.
  useEffect(() => {
    const on = (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && typing) { setQuery(''); e.target.blur(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // Scoped = search, type and person. The card numbers are computed from this,
  // so they do not move when you click one of them.
  const scoped = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) =>
      (!type || r.type === type) &&
      (!person || (teams[r.id] || []).some((t) => t.name === person)) &&
      matches(r, query, teams[r.id]));
  }, [rows, teams, person, type, query]);

  const totals = useMemo(() => summarise(scoped), [scoped]);

  const visible = useMemo(
    () => sortRows(focus ? scoped.filter(FOCUS[focus]) : scoped, sort),
    [scoped, focus, sort]);

  const filtering = !!(query || type || person || focus);
  const clearAll = () => { setQuery(''); setType(''); setPerson(''); setFocus(null); };

  if (configError) {
    return (
      <div className="state">
        <strong>Not configured</strong>
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
    <>
      <div className="appbar">
        <div className="inner">
          <span className="mark"><span className="glyph">KA</span>Projects</span>
          <span className="count num">
            {rows ? (visible.length === rows.length
              ? `${rows.length} projects`
              : `${visible.length} of ${rows.length}`) : ''}
          </span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
            <LogOut size={15} />Sign out
          </button>
        </div>
      </div>

      <div className="wrap">
        <Cards totals={totals} focus={focus} setFocus={setFocus} />

        <div className="toolbar">
          <div className="search">
            <Search size={15} />
            <input
              ref={searchRef}
              value={query}
              placeholder="Search projects, stages, people"
              aria-label="Search projects, stages and people"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query
              ? <button className="x" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>
              : <span className="kbd">/</span>}
          </div>

          <div className="seg" role="group" aria-label="Filter by discipline">
            {TYPES.map(([v, l]) => (
              <button key={v || 'all'} aria-pressed={type === v} onClick={() => setType(v)}
                      title={v ? `Only ${v} projects` : 'All disciplines'}>
                {l}
              </button>
            ))}
          </div>

          <select className="select" value={person} onChange={(e) => setPerson(e.target.value)}
                  aria-label="Filter by person">
            <option value="">Anyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort the board">
            <option value="overrun">Most overdue first</option>
            <option value="name">Name, A–Z</option>
            <option value="stage">Stage order</option>
          </select>

          {filtering && (
            <button className="btn ghost" onClick={clearAll}><X size={14} />Clear</button>
          )}
        </div>

        {error && (
          <p className="err inline">
            <Alert size={15} />
            <span>
              Could not load the board: {error}
              {' '}If this says permission denied, the RLS policies in <code>0003_rls.sql</code> may not be applied.
            </span>
          </p>
        )}

        {!rows && !error && (
          <div className="tablecard" style={{ padding: 14 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} className="skel" style={{ height: 18, margin: '12px 4px', opacity: 1 - i * 0.09 }} />
            ))}
          </div>
        )}

        {rows && visible.length === 0 && (
          <div className="state">
            <Inbox size={26} />
            <strong>Nothing matches</strong>
            <p>No project matches this filter. All {rows.length} are still there.</p>
            <button className="btn" onClick={clearAll}><X size={14} />Clear the filters</button>
          </div>
        )}

        {rows && visible.length > 0 && (
          <Board rows={visible} teams={teams} sort={sort} setSort={setSort} />
        )}
      </div>
    </>
  );
}
