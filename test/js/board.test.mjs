// What a board row means. These are the claims the board makes on screen, so
// they are worth pinning: a wrong lateness basis puts the wrong project at the
// top, and a wrong idle reason tells the studio it has no data when it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lateness, idleReason, summarise, sortRows, matches, planDays, deliverySoon, FOCUS }
  from '../../src/lib/board.js';

const row = (o) => ({
  id: o.id ?? 'x', name: o.name ?? 'A project', type: 'AR', status: 'ongoing',
  substage_count: 25, in_scope_count: 13, done_count: 0, started_count: 1,
  days_over: null, days_past_target: null, days_past_section: null,
  substage_name: 'MASSING & ZONING CONCEPT', ...o,
});

test('lateness prefers the plan, then the target, then the section deadline', () => {
  assert.deepEqual(lateness(row({ days_over: 5, days_past_target: 90, days_past_section: 200 })),
    { days: 5, basis: 'past plan', late: true });
  assert.deepEqual(lateness(row({ days_past_target: 90, days_past_section: 200 })),
    { days: 90, basis: 'past target', late: true });
  assert.deepEqual(lateness(row({ days_past_section: 200 })),
    { days: 200, basis: 'past section deadline', late: true });
});

test('inside the plan is not late, and a zero overrun is not an overrun', () => {
  assert.equal(lateness(row({ days_over: -4 })).late, false);
  assert.equal(lateness(row({ days_over: 0 })).late, false);
  assert.equal(lateness(row({})).late, false);
});

test('the four silences are told apart', () => {
  assert.equal(idleReason(row({ substage_count: 0, in_scope_count: 0, started_count: 0 })), 'No stages tracked');
  assert.equal(idleReason(row({ started_count: 0 })), 'Not started');
  assert.equal(idleReason(row({ in_scope_count: 4, done_count: 4, started_count: 4 })), 'All stages done');
  assert.equal(idleReason(row({ in_scope_count: 4, done_count: 1, started_count: 2 })), 'Nothing in process');
});

test('a plan is quoted in working days, and the view wins over the fallback', () => {
  assert.equal(planDays({ planned_days: 18, planned_weeks: 3 }), 18);
  assert.equal(planDays({ planned_weeks: 3 }), 18);
  assert.equal(planDays({ planned_weeks: null }), null);
});

test('delivery is soon inside four working weeks, and stays soon once overdue', () => {
  assert.equal(deliverySoon({ days_to_delivery: 5 }), true);
  assert.equal(deliverySoon({ days_to_delivery: -30 }), true);
  assert.equal(deliverySoon({ days_to_delivery: 25 }), false);
  assert.equal(deliverySoon({ days_to_delivery: null, target_delivery: null }), false);
});

test('the board leads with the worst overrun, and idle rows sink but never vanish', () => {
  const rows = [
    row({ id: 'a', name: 'Quiet', substage_name: null, started_count: 0 }),
    row({ id: 'b', name: 'Bad', days_over: 40 }),
    row({ id: 'c', name: 'Worse', days_over: 90 }),
    row({ id: 'd', name: 'Fine' }),
  ];
  assert.deepEqual(sortRows(rows).map((r) => r.name), ['Worse', 'Bad', 'Fine', 'Quiet']);
  assert.equal(sortRows(rows).length, rows.length);   // nothing is dropped
});

test('summarise counts the gap as work nobody has begun', () => {
  const t = summarise([
    row({ started_count: 0 }),
    row({ days_over: 3 }),
    row({ status: 'completed' }),
  ]);
  assert.deepEqual(t, { live: 2, late: 1, soon: 0, idle: 1 });
});

test('search matches a project, a stage or a colleague, and needs every word', () => {
  const r = row({ name: 'Ashok Ranka', client_name: 'Ranka Group' });
  const team = [{ name: 'Madhu', role: 'DD' }];
  assert.equal(matches(r, 'ashok', team), true);
  assert.equal(matches(r, 'madhu', team), true);
  assert.equal(matches(r, 'massing', team), true);
  assert.equal(matches(r, 'ashok madhu', team), true);
  assert.equal(matches(r, 'ashok selva', team), false);
  assert.equal(matches(r, '', team), true);
});

/* ---------------------------------------------------------- completed ---- */
/* A project the studio has closed. Every one of these is a claim the board
   makes on screen the moment somebody presses "Project completed", and they
   have to agree with each other: a card counting a finished project that its
   own filter then refuses to show is the kind of quiet disagreement that stops
   a number being trusted. */

const done = (o = {}) => row({ status: 'completed', ...o });

test('a completed project is never late, whatever its stages still say', () => {
  // Its substages are left exactly where they stood, so the raw overrun is
  // still in the row. It is history, not an overrun anybody can act on.
  assert.deepEqual(lateness(done({ days_over: 90, days_past_target: 40, days_past_section: 12 })),
    { days: null, basis: null, late: false });
});

test('a completed project is never delivering soon, and never overdue for it', () => {
  assert.equal(deliverySoon(done({ days_to_delivery: 3 })), false);
  assert.equal(deliverySoon(done({ days_to_delivery: -200 })), false);
});

test('none of the four board numbers counts a completed project', () => {
  const t = summarise([
    done({ days_over: 90, days_to_delivery: 2, started_count: 0 }),
    row({ days_over: 3 }),
  ]);
  assert.deepEqual(t, { live: 1, late: 1, soon: 0, idle: 0 });
});

test('every card filter shows exactly the rows its number counted', () => {
  const rows = [
    done({ id: 'f', days_over: 90, days_to_delivery: 2, started_count: 0 }),
    row({ id: 'l', days_over: 3 }),
    row({ id: 'i', started_count: 0 }),
  ];
  const t = summarise(rows);
  for (const key of ['live', 'late', 'soon', 'idle']) {
    assert.equal(rows.filter(FOCUS[key]).length, t[key], `${key} card and filter disagree`);
  }
  assert.equal(rows.filter(FOCUS.late).map((r) => r.id).includes('f'), false);
});

test('completed projects sink to the bottom of every order, and none is dropped', () => {
  const rows = [
    done({ id: 'f1', name: 'Aardvark', days_over: 99, days_to_delivery: 1, substage_name: 'X',
           stage_group_name: 'A GROUP' }),
    row({ id: 'a', name: 'Zebra', days_over: 4, days_to_delivery: 30,
          substage_name: 'Y', stage_group_name: 'B GROUP' }),
    done({ id: 'f2', name: 'Beetle' }),
    row({ id: 'b', name: 'Yak', substage_name: null, started_count: 0 }),
  ];
  for (const key of ['overrun', 'name', 'delivery', 'stage']) {
    const out = sortRows(rows, key);
    assert.equal(out.length, rows.length, `${key} dropped a row`);
    assert.deepEqual(out.slice(2).map((r) => r.id).sort(), ['f1', 'f2'],
      `${key} did not sink the completed projects`);
  }
  // And they are still ordered among themselves, not left in input order.
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.name),
    ['Yak', 'Zebra', 'Aardvark', 'Beetle']);
});
