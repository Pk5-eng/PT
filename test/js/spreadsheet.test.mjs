// Does what the app reports still match the spreadsheet it replaced?
//
// seed.json is the decoded spreadsheet, and supabase/seed.sql is generated from
// it, so asserting a figure against seed.json here and against the loaded
// database in test/01_behaviour.sql pins the same number at both ends. If the
// decode ever changes, this fails first and names what moved; if a migration or
// a query drifts, the SQL side fails. Neither can move quietly.
//
// The numbers below are not typed from memory. They are what
// `node scripts/seed.mjs --dry-run` reports, and the two the build spec itself
// asserts (Madhu 14, Selva 7) are among them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamLoad } from '../../src/lib/analytics.js';

const sheet = JSON.parse(readFileSync(new URL('../../seed.json', import.meta.url)));

// scripts/seed.mjs, DECISIONS block B1. Repeated rather than imported because
// seed.mjs is a script that runs and exits; if it is ever made importable this
// should read from it instead.
const ROLE = { DD: 'DD', WD: 'WD', ID: 'DD', '.': 'INVOLVED', '-': 'INVOLVED' };

test('the spreadsheet still decodes to the shape the app was built for', () => {
  assert.equal(sheet.projects.length, 37);
  assert.equal(sheet.stage_groups.length, 7);
  assert.equal(sheet.projects.reduce((n, p) => n + p.substages.length, 0), 151);
  assert.equal(sheet.projects.reduce((n, p) => n + Object.keys(p.assignments ?? {}).length, 0), 70);
});

test('team load, computed the way the screen computes it, matches the spreadsheet', () => {
  // Build the same inputs teamLoad() takes on screen, straight from the sheet.
  const rows = sheet.projects.map((p, i) => ({ id: `p${i}`, status: 'ongoing' }));
  const teams = {};
  sheet.projects.forEach((p, i) => {
    teams[`p${i}`] = Object.entries(p.assignments ?? {})
      .map(([name, role]) => ({ name, role: ROLE[role] ?? role }));
  });

  assert.deepEqual(teamLoad(teams, rows), [
    { label: 'Madhu', value: 14 },
    { label: 'Selva', value: 7 },
    { label: 'Pavan', value: 6 },
    { label: 'Vibhaas', value: 5 },
    { label: 'Varun', value: 4 },
    { label: 'Venugopal', value: 4 },
    { label: 'Niharika', value: 3 },
    { label: 'Gururaj Sir', value: 1 },
  ]);
});

test('the spec\'s own two acceptance numbers survive', () => {
  const rows = sheet.projects.map((p, i) => ({ id: `p${i}`, status: 'ongoing' }));
  const teams = {};
  sheet.projects.forEach((p, i) => {
    teams[`p${i}`] = Object.entries(p.assignments ?? {})
      .map(([name, role]) => ({ name, role: ROLE[role] ?? role }));
  });
  const by = Object.fromEntries(teamLoad(teams, rows).map((d) => [d.label, d.value]));
  assert.equal(by.Madhu, 14);
  assert.equal(by.Selva, 7);
});

test('the principal is advisory on most of his projects, and load says so', () => {
  // 15 of Gururaj Sir's 16 rows are the oversight marker. Counting them would
  // make him the busiest person in the studio, which is the opposite of true.
  const all = sheet.projects.filter((p) => 'Gururaj Sir' in (p.assignments ?? {})).length;
  const owning = sheet.projects.filter(
    (p) => ROLE[p.assignments?.['Gururaj Sir']] === 'DD' || ROLE[p.assignments?.['Gururaj Sir']] === 'WD').length;
  assert.equal(all, 16);
  assert.equal(owning, 1);
});

test('the sheet carried seven dates in total, and that is all there was', () => {
  // The whole reason dates are stamped rather than typed: across 151 rows of a
  // live practice, seven had a date on them.
  const dated = sheet.projects.flatMap((p) => p.substages.filter((s) => s.concluded_on));
  assert.equal(dated.length, 7);

  // Five of those sit on rows that were not done, so they are expectations
  // rather than records, and became target_date (migration 0004, decision B4).
  assert.equal(dated.filter((s) => s.status !== 'done').length, 5);
});

test('no row in the sheet ever recorded when work STARTED', () => {
  // Which is why days_over is null everywhere on day one and the board leans on
  // the target date until the app has been used for a while.
  const started = sheet.projects.flatMap((p) => p.substages.filter((s) => s.started_on));
  assert.equal(started.length, 0);
});

test('twenty projects arrived with no stage data at all', () => {
  const empty = sheet.projects.filter((p) => p.substages.length === 0).length;
  assert.equal(empty, 20);
});
