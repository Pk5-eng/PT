import { useEffect, useState } from 'react';

// Hash routing, hand-rolled. The app has two routes; a router library would be
// a dependency for something this file does in fifteen lines, and the
// dependency list is fixed by CLAUDE.md.
//
//   #/            the board
//   #/p/<uuid>    one project

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const m = /^#\/p\/([0-9a-f-]{36})$/i.exec(hash);
  return m ? { name: 'project', projectId: m[1] } : { name: 'board' };
}

export const go = (path) => { window.location.hash = path; };
export const toProject = (id) => go(`/p/${id}`);
export const toBoard = () => go('/');
