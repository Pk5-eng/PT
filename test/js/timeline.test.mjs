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

import { masterTimeline, masterBands } from '../../src/lib/timeline.js';

test('the master timeline gives every project every section, in studio order', () => {
  const st = (project_id, group_id, seq, status, o = {}) => ({
    project_id, group_id, group: group_id.toUpperCase(), group_seq: seq, status,
    started_on: null, concluded_on: null, ...o,
  });
  const { columns, rows } = masterTimeline({
    projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }, { id: 'p3', name: 'Gamma' }],
    stages: [
      st('p1', 'b', 2, 'not_started'), st('p1', 'a', 1, 'in_process'),
      st('p2', 'a', 1, 'done'), st('p2', 'b', 2, 'in_process'),
      st('p3', 'a', 1, 'not_started'),
    ],
    sections: [{ project_id: 'p1', group_id: 'a', target_date: '2026-11-09' }],
  }, '2026-11-12');

  assert.deepEqual(columns.map((c) => c.id), ['a', 'b'], 'ordered by section seq, not arrival');
  assert.deepEqual(rows.map((r) => r.name), ['Beta', 'Alpha', 'Gamma'], 'furthest through the job first');
  assert.equal(rows[1].steps[0].over, 3, 'section deadline overrun in working days');
  assert.equal(rows[1].late, true);
  assert.equal(rows[2].steps[1].state, 'untracked', 'a section never set up is not called out of scope');
  assert.equal(rows[2].steps[1].deadline, null);
});

test('each discipline band keeps only the sections its own projects have in scope', () => {
  const st = (project_id, group_id, seq, status) => ({
    project_id, group_id, group: group_id, group_seq: seq, status, started_on: null, concluded_on: null,
  });
  const bands = masterBands(masterTimeline({
    projects: [{ id: 'i', name: 'Interior', type: 'ID' }, { id: 'a', name: 'Arch', type: 'AR' }],
    stages: [
      st('a', 'concept', 1, 'in_process'), st('a', 'gfc-id', 2, 'not_in_scope'),
      st('i', 'concept', 1, 'not_in_scope'), st('i', 'gfc-id', 2, 'not_started'),
    ],
  }, '2026-11-12'));
  assert.deepEqual(bands.map((b) => b.type), ['AR', 'ID'], 'AR, ID, IR order regardless of arrival');
  assert.deepEqual(bands[0].columns.map((c) => c.id), ['concept']);
  assert.deepEqual(bands[1].columns.map((c) => c.id), ['gfc-id'], 'not-started still counts as in scope');
  assert.equal(bands[0].columns[0].in_process, 1);
  assert.equal(bands[0].rows[0].steps.length, 1);
});
