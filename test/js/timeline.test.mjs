// The project timeline states one word per section. These pin which word, and
// that no date on it is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseState, timelineSteps } from '../../src/lib/timeline.js';

const s = (status, o = {}) => ({ status, started_on: null, concluded_on: null, ...o });

test('a section reads as one word, and out-of-scope work does not count', () => {
  assert.equal(phaseState([s('not_in_scope'), s('cancelled')]), 'not_in_scope');
  assert.equal(phaseState([s('done'), s('not_in_scope')]), 'done');
  assert.equal(phaseState([s('done'), s('in_process')]), 'in_process');
  assert.equal(phaseState([s('hold'), s('not_started')]), 'hold');
  assert.equal(phaseState([s('in_process'), s('hold')]), 'in_process');
  assert.equal(phaseState([s('done'), s('not_started')]), 'partly_done');
  assert.equal(phaseState([s('not_started')]), 'not_started');
  assert.equal(phaseState([]), 'not_in_scope');
});

test('a finish date is given only when every substage recorded one', () => {
  const [full, partial] = timelineSteps([
    { id: 'a', name: 'A', rows: [s('done', { concluded_on: '2026-03-04' }), s('done', { concluded_on: '2026-05-01' })] },
    { id: 'b', name: 'B', rows: [s('done', { concluded_on: '2026-03-04' }), s('done')] },
  ]);
  assert.equal(full.finished_on, '2026-05-01');
  assert.equal(partial.finished_on, null);
  assert.equal(partial.label, 'Done');
});

test('a deadline is late in working days, and never on a finished section', () => {
  // Thursday 12 Nov 2026, deadline Monday 9 Nov: Tue, Wed, Thu = 3, no Sunday between.
  const [live, done, none] = timelineSteps([
    { id: 'a', name: 'A', rows: [s('in_process', { started_on: '2026-10-01' })] },
    { id: 'b', name: 'B', rows: [s('done')] },
    { id: 'c', name: 'C', rows: [s('not_started')] },
  ], { a: '2026-11-09', b: '2026-11-09' }, '2026-11-12');
  assert.equal(live.over, 3);
  assert.equal(live.started_on, '2026-10-01');
  assert.equal(done.over, null);
  assert.equal(none.deadline, null, 'no section borrows a deadline it does not have');
});
