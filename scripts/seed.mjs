#!/usr/bin/env node
/**
 * Phase 1 seed loader.
 *
 *   node scripts/seed.mjs --dry-run    transform only, print what would load
 *   node scripts/seed.mjs              transform and write to Supabase
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY when not a dry run. The
 * service role key is required because RLS restricts the taxonomy tables to
 * admins and this runs before any admin exists. It never ships to the browser.
 *
 * Every judgement call the seed data forced is in the DECISIONS block below and
 * nowhere else. Change a value there and re-run the dry run to see the effect.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ===========================================================================
// DECISIONS  -  see docs/PHASE0_AUDIT.md for why each of these exists
// ===========================================================================

/**
 * B1. The sheet uses five role markers; the schema allows six codes, none of
 * which are three of those markers.
 *
 *   "."  oversight marker, 21 rows, 16 of them Gururaj Sir (the principal)
 *   "-"  a person is named but no role was recorded, 5 rows
 *   "ID" a discipline, not a role, 2 rows (Selva and Vibhaas on ID projects)
 *
 * This mapping is the one that reproduces both numbers the spec asserts:
 * Madhu = 14 and Selva = 7 non-INVOLVED assignments. That is the evidence for
 * it, not a preference.
 */
const ROLE_CODE_MAP = {
  DD: 'DD',
  WD: 'WD',
  ID: 'DD',        // discipline recorded in the role column; DD is the work it means
  '.': 'INVOLVED', // advisory, owns no work - exactly the INVOLVED definition
  '-': 'INVOLVED', // no role recorded; INVOLVED so it does not inflate team load
};

/**
 * B4. Four rows are a date with no colour. The schema has no such status.
 * A date on a row that is not done reads as a target, not a conclusion -
 * Anup Embassy Springs has one on an explicitly in_process row too.
 */
const UNKNOWN_STATUS_BECOMES = 'in_process';

/**
 * B4 continued. stamp_and_log() nulls concluded_on on any status change away
 * from 'done'. Seeding a date onto a non-done row therefore stores a value the
 * first dropdown change silently erases. Better to not store it than to store
 * something that disappears without anyone being told.
 */
const DROP_CONCLUDED_ON_WHEN_NOT_DONE = true;

/** B5. One row is in_process with the note "HOLD". The schema has a hold status. */
const NOTE_TO_STATUS = { HOLD: 'hold' };

/**
 * B6. Seven projects have status null, priority null and no substages - a
 * separate tranche in the sheet. The column default is 'ongoing', which would
 * put seven enquiries on the live board. Set to null to use the column default.
 */
const NULL_PROJECT_STATUS_BECOMES = 'not_confirmed';

/**
 * B2. "MATERIAL SELECTION" appears twice inside GFC-ID (seq 17 and seq 20).
 * Project rows name substages by (group, name) and cannot tell them apart.
 *
 *   'collapse' - treat seq 20 as a repeated spreadsheet row, load one substage
 *   'keep'     - load both; every project referencing it takes the lower seq
 *                and the second stays unreferenced until someone renames it
 */
const DUPLICATE_SUBSTAGE_POLICY = 'collapse';

/**
 * D6. "Mukesh Gala" (sl 25) and "Muskesh Gala" (sl 34) are probably one client.
 * Merging is destructive and is a client-identity question, so both load and
 * the merge stays a decision someone makes in the app.
 */
const MERGE_NEAR_DUPLICATE_PROJECTS = false;

/**
 * D2. Nothing in the sheet records when work started. started_on is left null.
 * It is NOT back-filled: an invented start date would feed every duration and
 * overrun figure the board exists to show, permanently and invisibly.
 * CLAUDE.md rule 2 - dates are stamped, never authored.
 */

// ===========================================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(root, 'seed.json'), 'utf8'));
const DRY = process.argv.includes('--dry-run');

const warnings = [];
const warn = (m) => { warnings.push(m); };

// --- transform -------------------------------------------------------------

const people = seed.people.map((name) => ({
  name,
  // The firm is on one domain; adjust before running for real. email is unique
  // and nullable, so leaving these null is also valid.
  email: null,
  role: name === 'Gururaj Sir' ? 'admin' : 'member',
  active: true,
}));

const stageGroups = seed.stage_groups.map((g, i) => ({
  name: g.name,
  seq: i,              // seq is not in seed.json; array order is the only source
  active: true,
}));

const numericWeeks = (v) => {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return null;
  warn(`planned_weeks ${JSON.stringify(v)} is not a number; loaded as null`);
  return null;          // B3: the string "NA"
};

// Substages, with the duplicate-inside-one-group problem resolved here.
const substages = [];
const substageKey = new Map();      // "GROUP :: NAME" -> index into substages
const collapsed = [];
for (const s of seed.substages) {
  const key = `${s.group} :: ${s.name}`;
  if (substageKey.has(key)) {
    if (DUPLICATE_SUBSTAGE_POLICY === 'collapse') {
      collapsed.push(`${key} (seq ${s.seq}) collapsed into seq ${substages[substageKey.get(key)].seq}`);
      continue;
    }
    warn(`${key} loaded twice; project rows will all resolve to the lower seq`);
  } else {
    substageKey.set(key, substages.length);
  }
  substages.push({
    group: s.group,
    name: s.name,
    seq: s.seq,
    planned_weeks: numericWeeks(s.planned_weeks),
    active: true,
    deliverables: s.deliverables.map((name, i) => ({ name, seq: i, active: true })),
  });
}

const projects = [];
const assignments = [];
const projectSubstages = [];
const skippedAssignments = [];

for (const p of seed.projects) {
  const status = p.status ? p.status.toLowerCase() : NULL_PROJECT_STATUS_BECOMES;
  const key = `${p.sl}|${p.name}`;
  projects.push({
    key,
    name: p.name,
    type: p.type,
    status,
    priority: p.priority,
    code: null,           // D5: not present in seed.json
    client_name: null,
    site_location: null,
  });

  for (const [person, raw] of Object.entries(p.assignments)) {
    const role_code = ROLE_CODE_MAP[raw];
    if (!role_code) { skippedAssignments.push(`${p.name} / ${person} / ${JSON.stringify(raw)}`); continue; }
    if (!seed.people.includes(person)) { skippedAssignments.push(`${p.name} / unknown person ${person}`); continue; }
    assignments.push({ project: key, person, role_code, raw });
  }

  const seen = new Set();
  for (const r of p.substages) {
    const sKey = `${r.group} :: ${r.substage}`;
    if (!substageKey.has(sKey)) { warn(`${p.name} references unknown substage ${sKey}; skipped`); continue; }
    if (seen.has(sKey)) {
      warn(`${p.name} references ${sKey} twice; second occurrence dropped (unique constraint)`);
      continue;
    }
    seen.add(sKey);

    let status = r.status;
    if (status === 'unknown') status = UNKNOWN_STATUS_BECOMES;
    if (r.note && NOTE_TO_STATUS[r.note]) status = NOTE_TO_STATUS[r.note];
    else if (r.note) warn(`${p.name} / ${r.substage}: note ${JSON.stringify(r.note)} has nowhere to go and is dropped`);

    let concluded_on = r.concluded_on;
    if (concluded_on && status !== 'done' && DROP_CONCLUDED_ON_WHEN_NOT_DONE) {
      warn(`${p.name} / ${r.substage}: concluded_on ${concluded_on} dropped, status is '${status}' not 'done'`);
      concluded_on = null;
    }

    projectSubstages.push({
      project: key,
      substage: sKey,
      status,
      started_on: null,   // D2: never invented
      concluded_on,
    });
  }
}

// --- report ----------------------------------------------------------------

const load = (n, label) => console.log(`  ${String(n).padStart(4)}  ${label}`);
console.log(`\nKA dashboard seed  ${DRY ? '[DRY RUN - nothing will be written]' : '[LIVE]'}\n`);
console.log('rows to load');
load(people.length, 'people');
load(stageGroups.length, 'stage_groups');
load(substages.length, 'substages');
load(substages.reduce((n, s) => n + s.deliverables.length, 0), 'deliverables');
load(projects.length, 'projects');
load(assignments.length, 'assignments');
load(projectSubstages.length, 'project_substage');

if (collapsed.length) {
  console.log('\nduplicate substages collapsed');
  for (const c of collapsed) console.log(`  ${c}`);
}
if (skippedAssignments.length) {
  console.log('\nassignments skipped');
  for (const s of skippedAssignments) console.log(`  ${s}`);
}
if (warnings.length) {
  console.log(`\nwarnings (${warnings.length})`);
  for (const w of warnings) console.log(`  ${w}`);
}

console.log('\nassignments per person, as the Team-load screen will count them');
console.log('  person           all   excluding INVOLVED');
const counts = new Map(seed.people.map((n) => [n, { all: 0, real: 0 }]));
for (const a of assignments) {
  const c = counts.get(a.person);
  c.all++;
  if (a.role_code !== 'INVOLVED') c.real++;
}
for (const [n, c] of [...counts.entries()].sort((a, b) => b[1].real - a[1].real)) {
  console.log(`  ${n.padEnd(16)} ${String(c.all).padStart(3)}   ${String(c.real).padStart(3)}`);
}
const madhu = counts.get('Madhu').real;
const selva = counts.get('Selva').real;
console.log(`\nspec acceptance: Madhu = 14 and Selva = 7`);
console.log(`actual:          Madhu = ${madhu} and Selva = ${selva}   ${madhu === 14 && selva === 7 ? 'PASS' : 'FAIL'}`);

const statusCounts = new Map();
for (const r of projectSubstages) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
console.log('\nproject_substage status distribution');
for (const [s, n] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(12)} ${n}`);
console.log(`\nprojects with no substage rows: ${projects.length - new Set(projectSubstages.map((r) => r.project)).size}`);
console.log(`rows with started_on:           ${projectSubstages.filter((r) => r.started_on).length}  (board duration columns stay blank until the app is used)`);

if (DRY) {
  console.log('\ndry run complete, nothing written.\n');
  process.exit(madhu === 14 && selva === 7 ? 0 : 1);
}

// --- load ------------------------------------------------------------------

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Use --dry-run to transform only.\n');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, key, { auth: { persistSession: false } });

const insert = async (table, rows) => {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
};

const existing = await db.from('projects').select('id').limit(1);
if (existing.error) throw new Error(`cannot reach Supabase: ${existing.error.message}`);
if (existing.data.length) {
  console.error('\nprojects already has rows. This script loads an empty database only.');
  console.error('Truncate first, or seed a fresh project.\n');
  process.exit(1);
}

console.log('\nloading...');

const peopleRows = await insert('people', people);
const peopleId = new Map(peopleRows.map((r) => [r.name, r.id]));

const groupRows = await insert('stage_groups', stageGroups);
const groupId = new Map(groupRows.map((r) => [r.name, r.id]));

const subRows = await insert('substages', substages.map((s) => ({
  stage_group_id: groupId.get(s.group), name: s.name, seq: s.seq,
  planned_weeks: s.planned_weeks, active: s.active,
})));
const subId = new Map(subRows.map((r, i) => [`${substages[i].group} :: ${substages[i].name}`, r.id]));

await insert('deliverables', substages.flatMap((s) =>
  s.deliverables.map((d) => ({
    substage_id: subId.get(`${s.group} :: ${s.name}`), name: d.name, seq: d.seq, active: d.active,
  }))));

const projRows = await insert('projects', projects.map((p) => ({
  name: p.name, type: p.type, status: p.status, priority: p.priority,
  code: p.code, client_name: p.client_name, site_location: p.site_location,
})));
const projId = new Map(projRows.map((r, i) => [projects[i].key, r.id]));

await insert('assignments', assignments.map((a) => ({
  project_id: projId.get(a.project), person_id: peopleId.get(a.person), role_code: a.role_code,
})));

await insert('project_substage', projectSubstages.map((r) => ({
  project_id: projId.get(r.project), substage_id: subId.get(r.substage),
  status: r.status, started_on: r.started_on, concluded_on: r.concluded_on,
})));

console.log('done.\n');
console.log('Verify in the SQL editor:\n');
console.log(`  select p.name, count(*) as active_assignments
  from assignments a
  join people p on p.id = a.person_id
  where a.role_code <> 'INVOLVED' and p.active
  group by p.name
  order by active_assignments desc;\n`);
console.log('  Madhu must return 14.\n');
