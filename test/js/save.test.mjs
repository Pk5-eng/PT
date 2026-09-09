// The smallest honest write.
//
// The cases that matter here are the destructive ones: a save that sends a
// field nobody touched reverts a colleague's edit, and a team update that
// deletes before it inserts can lose the team outright. Both were real shapes
// in this codebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, diffAssignments, isNoop } from '../../src/lib/save.js';

test('a form saved without edits writes nothing', () => {
  const row = { name: 'Ashok Ranka', client_name: 'Ranka', priority: 3 };
  assert.deepEqual(changedFields(row, { ...row }), {});
});

test('only the field that moved is sent, so a colleague\'s edit survives', () => {
  // They changed the client while your form was open. You changed the name.
  // Sending the whole row would put their client_name back to what you loaded.
  const loaded = { name: 'Ashok Ranka', client_name: 'Ranka', priority: 3 };
  const patch = changedFields(loaded, { ...loaded, name: 'Ashok Ranka House' });
  assert.deepEqual(patch, { name: 'Ashok Ranka House' });
  assert.equal('client_name' in patch, false);
});

test('an empty string and a null are the same absence, not a change', () => {
  // A text input reads '' where the database holds null. Treating that as an
  // edit would write null over null on every save, for every empty field.
  assert.deepEqual(changedFields({ code: null }, { code: '' }), {});
  assert.deepEqual(changedFields({ code: undefined }, { code: null }), {});
  assert.deepEqual(changedFields({ code: 'KA-01' }, { code: '' }), { code: '' });
  assert.deepEqual(changedFields({ code: null }, { code: 'KA-01' }), { code: 'KA-01' });
});

test('clearing a date is a change, not an absence', () => {
  assert.deepEqual(changedFields({ target_delivery: '2026-10-01' }, { target_delivery: null }),
    { target_delivery: null });
});

test('a new team member is an insert and nobody else is touched', () => {
  const before = [{ person_id: 'madhu', role_code: 'DD' }];
  const d = diffAssignments(before, { madhu: 'DD', selva: 'WD' });
  assert.deepEqual(d.added, [{ person_id: 'selva', role_code: 'WD' }]);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, []);
});

test('a role change is an update, not a delete and an insert', () => {
  // Deleting the row and inserting a new one would give it a new id and a
  // moment where the person is not on the project at all.
  const before = [{ person_id: 'madhu', role_code: 'DD' }];
  const d = diffAssignments(before, { madhu: 'WD' });
  assert.deepEqual(d.changed, [{ person_id: 'madhu', role_code: 'WD' }]);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
});

test('taking someone off is the only delete, and it names only them', () => {
  const before = [
    { person_id: 'madhu', role_code: 'DD' },
    { person_id: 'selva', role_code: 'WD' },
  ];
  const d = diffAssignments(before, { madhu: 'DD' });
  assert.deepEqual(d.removed, ['selva']);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.changed, []);
});

test('an unchanged team writes nothing at all', () => {
  const before = [{ person_id: 'madhu', role_code: 'DD' }, { person_id: 'selva', role_code: 'WD' }];
  const d = diffAssignments(before, { madhu: 'DD', selva: 'WD' });
  assert.equal(isNoop(d), true);
});

test('emptying the team deletes only what was there, and adds nothing', () => {
  const before = [{ person_id: 'madhu', role_code: 'DD' }];
  const d = diffAssignments(before, {});
  assert.deepEqual(d.removed, ['madhu']);
  assert.equal(d.added.length + d.changed.length, 0);
});

test('a project with no team yet is handled without a special case', () => {
  assert.deepEqual(diffAssignments(undefined, { madhu: 'DD' }).added,
    [{ person_id: 'madhu', role_code: 'DD' }]);
  assert.equal(isNoop(diffAssignments(undefined, {})), true);
  assert.equal(isNoop(diffAssignments([], undefined)), true);
});
