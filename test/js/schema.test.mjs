// Telling "the database is behind" apart from everything else.
//
// The dangerous failure here is a FALSE POSITIVE. If a permission error or a
// dropped connection were read as schema drift, the app would quietly switch a
// feature off and blame a migration - and an actual RLS mistake, which is the
// whole authorisation boundary in this app, would never be reported. So the
// negative cases below matter more than the positive ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSchemaBehind, boardIsBehind } from '../../src/lib/schema.js';

test('the PostgREST schema-cache codes are recognised', () => {
  for (const code of ['PGRST202', 'PGRST204', 'PGRST205']) {
    assert.equal(isSchemaBehind({ code, message: 'whatever' }), true, code);
  }
});

test('the Postgres undefined-object codes are recognised', () => {
  for (const code of ['42P01', '42703', '42883']) {
    assert.equal(isSchemaBehind({ code, message: 'whatever' }), true, code);
  }
});

test('the exact sentence the live app showed is recognised, code or no code', () => {
  const msg = "Could not find the table 'public.project_stage_group' in the schema cache";
  assert.equal(isSchemaBehind({ code: 'PGRST205', message: msg }), true);
  assert.equal(isSchemaBehind({ message: msg }), true);
});

test('a missing column or function reads the same way', () => {
  assert.equal(isSchemaBehind({ message: "Could not find the 'target_delivery' column of 'projects' in the schema cache" }), true);
  assert.equal(isSchemaBehind({ message: 'Could not find the function public.ensure_project_structure in the schema cache' }), true);
});

test('a permission error is NEVER mistaken for schema drift', () => {
  // RLS is the entire authorisation boundary. Swallowing this would hide a
  // policy mistake behind a migration notice and nobody would look at it.
  assert.equal(isSchemaBehind({ code: '42501', message: 'permission denied for table projects' }), false);
  assert.equal(isSchemaBehind({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(isSchemaBehind({ message: 'new row violates row-level security policy' }), false);
});

test('a network or unknown failure is not schema drift either', () => {
  assert.equal(isSchemaBehind({ message: 'TypeError: Failed to fetch' }), false);
  assert.equal(isSchemaBehind({ message: 'could not find a suitable table' }), false);
  assert.equal(isSchemaBehind({}), false);
  assert.equal(isSchemaBehind(null), false);
  assert.equal(isSchemaBehind(undefined), false);
});

test('a board row without the new columns says the view is behind', () => {
  assert.equal(boardIsBehind([{ id: 'a', name: 'X', substage_count: 3 }]), true);
  assert.equal(boardIsBehind([{ id: 'a', name: 'X', started_count: 0 }]), false);
});

test('an empty or absent board is not evidence of anything', () => {
  // A brand new database has no projects. Accusing it of being behind on that
  // basis would put a permanent banner on an app that is perfectly fine.
  assert.equal(boardIsBehind([]), false);
  assert.equal(boardIsBehind(null), false);
  assert.equal(boardIsBehind(undefined), false);
});
