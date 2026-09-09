// The figures the analytics screen puts on screen. Each of these is a claim
// about the studio's work, so each is pinned to an example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSpent, teamLoad, throughput, statusMix, median, sectionLoad }
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

test('throughput keeps empty months, because a gap in output is a fact', () => {
  const now = new Date(2026, 8, 15);
  const out = throughput([
    { to_status: 'done', at: new Date(2026, 8, 2).toISOString() },
    { to_status: 'done', at: new Date(2026, 6, 2).toISOString() },
    { to_status: 'in_process', at: new Date(2026, 8, 3).toISOString() },  // not a conclusion
    { to_status: 'done', at: new Date(2020, 1, 1).toISOString() },        // outside the window
  ], 3, now);
  assert.deepEqual(out.map((d) => d.value), [1, 0, 1]);
  assert.equal(out.length, 3);
});

test('status mix drops nothing that exists and invents nothing that does not', () => {
  const rows = [{ status: 'ongoing' }, { status: 'ongoing' }, { status: 'hold' }];
  assert.deepEqual(statusMix(rows, ['ongoing', 'hold', 'completed']),
    [{ label: 'ongoing', value: 2 }, { label: 'hold', value: 1 }]);
});

test('section load counts stages in process, not projects', () => {
  const subs = [
    { status: 'in_process', section: 'CONCEPT DEVELOPMENT' },
    { status: 'in_process', section: 'CONCEPT DEVELOPMENT' },
    { status: 'done', section: 'CONCEPT DEVELOPMENT' },
    { status: 'in_process', section: 'GFC-ID' },
  ];
  assert.deepEqual(sectionLoad(subs, ['CONCEPT DEVELOPMENT', 'DESIGN DEVELOPMENT', 'GFC-ID']),
    [{ label: 'CONCEPT DEVELOPMENT', value: 2 },
     { label: 'DESIGN DEVELOPMENT', value: 0 },
     { label: 'GFC-ID', value: 1 }]);
});

test('median of an even count rounds, and of nothing is null', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
});
