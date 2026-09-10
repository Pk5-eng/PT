// The roster's rules, which are rules about people's records rather than about
// a form. A duplicate name makes two colleagues indistinguishable on every
// board row; an archive that quietly took someone off their projects would
// rewrite what happened. Both are worth pinning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanName, cleanEmail, nameProblem, emailProblem, rosterOrder, liveLoad, archiveWarning,
} from '../../src/lib/roster.js';

const team = [
  { id: '1', name: 'Madhu', email: null, active: true },
  { id: '2', name: 'Selva', email: 'selva@ka.test', active: true },
  { id: '3', name: 'Vanisree', email: null, active: false },
];

test('a name is trimmed and its inner runs collapsed', () => {
  assert.equal(cleanName('  Ravi   K '), 'Ravi K');
  assert.equal(cleanName(null), '');
});

test('a name is required, and a duplicate is refused however it is typed', () => {
  assert.equal(nameProblem('Niharika', team), null);
  assert.equal(nameProblem('   ', team), 'A name is needed.');
  assert.equal(nameProblem('  madhu ', team), 'Madhu is already on the team.');
});

test('an archived namesake asks to be restored, not duplicated', () => {
  // The archived row holds their assignments and their events. A second row
  // with the same name would be a different person as far as every join goes.
  assert.match(nameProblem('vanisree', team), /archived\. Restore them/);
});

test('an empty email is null, never the empty string', () => {
  // email is unique: two empty strings collide where two nulls do not.
  assert.equal(cleanEmail('   '), null);
  assert.equal(cleanEmail(' Selva@KA.test '), 'selva@ka.test');
});

test('an email is checked for shape and for a clash, and may be absent', () => {
  assert.equal(emailProblem('', team), null);
  assert.equal(emailProblem('new@ka.test', team), null);
  assert.equal(emailProblem('not-an-address', team), 'That does not look like an email address.');
  assert.equal(emailProblem('SELVA@ka.test', team), 'Selva already signs in with that address.');
  // Editing your own row is not a clash with yourself.
  assert.equal(emailProblem('selva@ka.test', team, '2'), null);
});

test('the roster reads team first, then the people who have left', () => {
  assert.deepEqual(rosterOrder(team).map((p) => p.name), ['Madhu', 'Selva', 'Vanisree']);
  assert.deepEqual(
    rosterOrder([{ name: 'Zed', active: true }, { name: 'Abe', active: false }]).map((p) => p.name),
    ['Zed', 'Abe']);
});

test('load counts live projects a person owns work on, never advisory ones', () => {
  const projects = [
    { id: 'p1', status: 'ongoing' },
    { id: 'p2', status: 'ongoing' },
    { id: 'p3', status: 'completed' },
  ];
  const assignments = [
    { project_id: 'p1', person_id: '1', role_code: 'DD' },
    { project_id: 'p2', person_id: '1', role_code: 'WD' },
    { project_id: 'p3', person_id: '1', role_code: 'DD' },   // not live
    { project_id: 'p1', person_id: '2', role_code: 'INVOLVED' }, // advisory owns no work
  ];
  const load = liveLoad(assignments, projects);
  assert.equal(load.get('1'), 2);
  assert.equal(load.get('2'), undefined);
});

test('the archive warning names what is left to hand over, and is silent when nothing is', () => {
  assert.equal(archiveWarning('Selva', 0), null);
  assert.match(archiveWarning('Selva', 1), /1 live project\b/);
  assert.match(archiveWarning('Selva', 3), /3 live projects/);
});
