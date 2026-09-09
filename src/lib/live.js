import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeping a screen honest without polling.
 *
 * Ten people share this board and a browser tab stays open for days. Nothing
 * refetched after the first load, so a board left open since Monday was
 * confidently showing Monday - and a stale board is worse than a slow one,
 * because it looks fine.
 *
 * Refetching on a timer would be the obvious fix and the wrong one: it burns
 * requests all night for nobody, on a free tier, to update a tab no one is
 * looking at. The moment that matters is when someone comes BACK to the tab,
 * which the browser tells us about directly.
 *
 * `paused` exists because a refresh is not always harmless. It replaces the
 * screen's state, and if a form is open on top of that state it would reset the
 * fields under the user's hands, or discard an edit that has not landed yet.
 * Freshness never wins over something a person is in the middle of.
 */
export function useRefreshOnReturn(refresh, { paused = false, minAgeMs = 30000 } = {}) {
  const lastAt = useRef(Date.now());
  const latest = useRef({ refresh, paused });
  latest.current = { refresh, paused };

  useEffect(() => {
    const maybe = () => {
      if (document.visibilityState !== 'visible') return;
      if (latest.current.paused) return;
      if (Date.now() - lastAt.current < minAgeMs) return;
      lastAt.current = Date.now();
      latest.current.refresh();
    };
    window.addEventListener('focus', maybe);
    document.addEventListener('visibilitychange', maybe);
    return () => {
      window.removeEventListener('focus', maybe);
      document.removeEventListener('visibilitychange', maybe);
    };
  }, [minAgeMs]);

  // Called after any load, so a screen that has just fetched is not refetched
  // the instant it regains focus.
  return useCallback(() => { lastAt.current = Date.now(); }, []);
}

/**
 * Apply a change on screen at once, send it, and put it back if the database
 * refuses.
 *
 * The pattern this replaces was: disable the control, send, wait, refetch the
 * entire screen, re-enable. On the project screen that was eight queries and a
 * full re-render for one dropdown, and the row you had just changed sat frozen
 * until all eight came back.
 *
 * The honesty condition is the revert. Optimism that cannot be taken back is
 * just lying quickly: if the write fails the value must go back to what the
 * database actually holds, and the failure must be said out loud. `settle` is
 * given whatever the database returned, so the screen ends up showing the row
 * as stored - the trigger's stamped dates included - rather than what we
 * guessed it would become.
 */
export async function optimistic({ apply, revert, send, settle, onError }) {
  apply();
  const { data, error } = await send();
  if (error) {
    revert();
    onError(error);
    return null;
  }
  if (settle && data) settle(data);
  return data ?? true;
}
