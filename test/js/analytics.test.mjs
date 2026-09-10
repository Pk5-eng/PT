// The figures the analytics screen puts on screen. Each of these is a claim
// about the studio's work, so each is pinned to an example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSpent, teamLoad, median, deadlineItems, overdue, dueWithin, undatedWork }
  from '../../src/lib/analytics.js';

test('days spent adds up each stage, and stops a finished one at its conclusion', () => {
  const subs = [
    { started_on: '2026-09-07', concluded_on: '2026-09-14' },   // 6
    { started_on: '2026-09-07', concluded_on: '2026-09-12' },   // 5
  ];
  assert.equal(daysSpent(subs, '2026-12-31'), 11);
});

test('a stage that never started contributes nothing, rather than being guessed at', () => {
  assert.equal(daysSpent([{ started_on: null, concluded_on: null }], '2026-09-14'), 0);
});

test('a running stage counts up to today', () => {
  assert.equal(daysSpent([{ started_on: '2026-09-07', concluded_on: null }], '2026-09-14'), 6);
});

test('team load excludes advisory involvement, which owns no work', () => {
  const teams = {
    p1: [{ name: 'Madhu', role: 'DD' }, { name: 'Gururaj Sir', role: 'INVOLVED' }],
    p2: [{ name: 'Madhu', role: 'WD' }],
    p3: [{ name: 'Selva', role: 'DD' }],
  };
  const rows = [{ id: 'p1', status: 'ongoing' }, { id: 'p2', status: 'ongoing' },
                { id: 'p3', status: 'completed' }];
  assert.deepEqual(teamLoad(teams, rows), [{ label: 'Madhu', value: 2 }]);
});




test('median of an even count rounds, and of nothing is null', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
});

/* ------------------------------------------------------- dated and undated -- */

const today = '2026-09-09';

test('the three kinds of commitment arrive in one list, soonest first', () => {
  const items = deadlineItems({
    projects: [{ id: 'p1', name: 'Ashok Ranka', target_delivery: '2026-10-01' }],
    sections: [{ id: 'g1', project_id: 'p1', project: 'Ashok Ranka', section: 'GFC - ARCHITECTURE', target_date: '2026-09-21' }],
    stages: [{ id: 's1', project_id: 'p1', project: 'Ashok Ranka', substage: 'CIVIL DRAWINGS',
               section: 'GFC - ARCHITECTURE', status: 'in_process', target_date: '2026-09-14' }],
  }, today);
  assert.deepEqual(items.map((i) => i.kind), ['stage', 'section', 'delivery']);
  assert.deepEqual(items.map((i) => i.days), [4, 10, 19]);   // working days: three Sundays fall in the last span
});

test('a missed date sorts above one that is merely close', () => {
  const items = deadlineItems({
    stages: [
      { id: 'a', project: 'A', substage: 'X', status: 'in_process', target_date: '2026-09-10' },
      { id: 'b', project: 'B', substage: 'Y', status: 'in_process', target_date: '2026-03-25' },
    ],
  }, today);
  assert.deepEqual(items.map((i) => i.project), ['B', 'A']);
  assert.ok(items[0].days < 0);
});

test('a finished stage\'s date is history, not a deadline', () => {
  const stages = [
    { id: 'a', project: 'A', substage: 'X', status: 'done', target_date: '2026-09-14' },
    { id: 'b', project: 'A', substage: 'Y', status: 'cancelled', target_date: '2026-09-14' },
    { id: 'c', project: 'A', substage: 'Z', status: 'not_in_scope', target_date: '2026-09-14' },
    { id: 'd', project: 'A', substage: 'W', status: 'in_process', target_date: '2026-09-14' },
  ];
  assert.deepEqual(deadlineItems({ stages }, today).map((i) => i.what), ['W']);
});

test('an undated thing contributes nothing rather than a guess', () => {
  const items = deadlineItems({
    projects: [{ id: 'p1', name: 'A', target_delivery: null }],
    sections: [{ id: 'g1', project: 'A', target_date: null }],
    stages: [{ id: 's1', project: 'A', substage: 'X', status: 'in_process', target_date: null }],
  }, today);
  assert.deepEqual(items, []);
});

test('overdue and due-soon split the list without overlapping or losing any', () => {
  const items = deadlineItems({
    stages: [
      { id: 'a', project: 'A', substage: 'past', status: 'in_process', target_date: '2026-08-01' },
      { id: 'b', project: 'A', substage: 'soon', status: 'in_process', target_date: '2026-09-21' },
      { id: 'c', project: 'A', substage: 'far',  status: 'in_process', target_date: '2027-01-01' },
    ],
  }, today);
  assert.deepEqual(overdue(items).map((i) => i.what), ['past']);
  assert.deepEqual(dueWithin(items, 24).map((i) => i.what), ['soon']);
});

test('undated work splits running from not-started, and keeps empty sections', () => {
  const stages = [
    { status: 'in_process',  section: 'CONCEPT DEVELOPMENT', target_date: null, section_target: null },
    { status: 'hold',        section: 'CONCEPT DEVELOPMENT', target_date: null, section_target: null },
    { status: 'not_started', section: 'CONCEPT DEVELOPMENT', target_date: null, section_target: null },
    { status: 'not_started', section: 'GFC-ID',              target_date: null, section_target: null },
  ];
  const out = undatedWork(stages, ['CONCEPT DEVELOPMENT', 'DESIGN DEVELOPMENT', 'GFC-ID']);
  assert.deepEqual(out.map((d) => [d.label, d.inProcess, d.notStarted]), [
    ['CONCEPT DEVELOPMENT', 2, 1],     // hold counts as begun
    ['DESIGN DEVELOPMENT', 0, 0],      // kept: a section with no gap is a fact too
    ['GFC-ID', 0, 1],
  ]);
});

test('a dated stage, or one under a dated section, is not undated', () => {
  const stages = [
    { status: 'in_process',  section: 'A', target_date: '2026-10-01', section_target: null },
    { status: 'in_process',  section: 'A', target_date: null, section_target: '2026-10-01' },
    { status: 'in_process',  section: 'A', target_date: null, section_target: null },
  ];
  assert.equal(undatedWork(stages, ['A'])[0].value, 1);
});

test('finished and out-of-scope work is never counted as unscheduled', () => {
  const stages = ['done', 'cancelled', 'not_in_scope'].map((status) =>
    ({ status, section: 'A', target_date: null, section_target: null }));
  assert.equal(undatedWork(stages, ['A'])[0].value, 0);
});
