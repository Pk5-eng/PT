// The Sunday rule, tested. This is the riskiest arithmetic added in this change
// and it is claimed to be identical to working_days() in migration 0008; the
// cases below are the same cases test/01_behaviour.sql asserts in SQL, so if
// the two ever diverge one of the two suites fails.
//
//   node --test test/js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingDays, plannedWorkingDays, dayNumber, days } from '../../src/lib/workdays.js';

test('a full week loses exactly one day', () => {
  assert.equal(workingDays('2026-09-07', '2026-09-14'), 6);   // Mon to Mon
  assert.equal(workingDays('2026-09-06', '2026-09-13'), 6);   // Sun to Sun
  assert.equal(workingDays('2026-09-05', '2026-09-12'), 6);   // Sat to Sat
});

test('four weeks is twenty-four working days', () => {
  assert.equal(workingDays('2026-09-07', '2026-10-05'), 24);
});

test('a range inside one week loses nothing', () => {
  assert.equal(workingDays('2026-09-07', '2026-09-12'), 5);   // Mon to Sat
});

test('a range that steps over one Sunday loses one day', () => {
  assert.equal(workingDays('2026-09-12', '2026-09-14'), 1);   // Sat to Mon
});

test('the same day is zero, not one', () => {
  assert.equal(workingDays('2026-09-07', '2026-09-07'), 0);
});

test('counting backwards is negative, which is how "days remaining" reads', () => {
  assert.equal(workingDays('2026-09-14', '2026-09-07'), -6);
});

test('dates before the Sunday anchor still count correctly', () => {
  // Floor division, not truncation: integer division towards zero would make
  // this 7, and every duration before 2000 would be a day too long.
  assert.equal(workingDays('1999-12-20', '1999-12-27'), 6);
  assert.equal(workingDays('1990-01-01', '1990-01-08'), 6);
});

test('a year of Sundays is 52 or 53, never more', () => {
  const lost = 365 - workingDays('2025-01-01', '2026-01-01');
  assert.ok(lost === 52 || lost === 53, `lost ${lost} days`);
});

test('null in, null out - a missing date is never treated as today', () => {
  assert.equal(workingDays(null, '2026-09-14'), null);
  assert.equal(workingDays('2026-09-14', null), null);
  assert.equal(dayNumber(undefined), null);
  assert.equal(dayNumber(''), null);
});

test('a timestamp is read by its date part, not by its clock', () => {
  assert.equal(workingDays('2026-09-07T23:30:00+05:30', '2026-09-14T00:10:00Z'), 6);
});

test('a plan in weeks is six working days to the week, not seven', () => {
  assert.equal(plannedWorkingDays(3), 18);
  assert.equal(plannedWorkingDays(1.5), 9);
  assert.equal(plannedWorkingDays(null), null);
});

test('one day is singular', () => {
  assert.equal(days(1), '1 day');
  assert.equal(days(0), '0 days');
  assert.equal(days(-3), '-3 days');
});
