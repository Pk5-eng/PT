import { useEffect, useState } from 'react';

// Hash routing, hand-rolled. The app has three routes; a router library would
// be a dependency for something this file does in twenty lines, and the
// dependency list is fixed by CLAUDE.md.
//
//   #/             the board
//   #/analytics    the numbers
//   #/p/<uuid>     one project

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const m = /^#\/p\/([0-9a-f-]{36})$/i.exec(hash);
  if (m) return { name: 'project', projectId: m[1] };
  if (/^#\/analytics\/?$/i.test(hash)) return { name: 'analytics' };
  return { name: 'board' };
}

export const go = (path) => { window.location.hash = path; };
export const toProject = (id) => go(`/p/${id}`);
export const toBoard = () => go('/');
export const toAnalytics = () => go('/analytics');
