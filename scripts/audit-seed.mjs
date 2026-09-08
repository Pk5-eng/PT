#!/usr/bin/env node
/**
 * Phase 0 audit of seed.json.
 *
 * Reads the decoded spreadsheet and reports everything that would either
 * fail a constraint in the spec's schema or silently load as wrong data.
 * Writes nothing. Run before any migration:  node scripts/audit-seed.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(root, 'seed.json'), 'utf8'));

// Constraints copied from KA_DASHBOARD_BUILD_SPEC.md section 3.
const PROJECT_TYPES = ['AR', 'ID', 'IR'];
const PROJECT_STATUSES = ['ongoing', 'hold', 'npp', 'not_confirmed', 'completed', 'cancelled'];
const SUBSTAGE_STATUSES = ['not_in_scope', 'not_started', 'in_process', 'done', 'hold', 'cancelled'];
const ROLE_CODES = ['PI', 'DD', 'WD', 'PE', 'CL', 'INVOLVED'];

const out = [];
const say = (s = '') => out.push(s);
const rule = (t) => { say(); say('='.repeat(78)); say(t); say('='.repeat(78)); };
const sub = (t) => { say(); say(t); say('-'.repeat(t.length)); };

// Findings are numbered so section 6 decisions can cite them.
const blockers = [];   // will fail a constraint or load ambiguously
const decisions = [];  // loads fine, but the value is wrong or useless

say('KABRA ARCHITECTS DASHBOARD - PHASE 0 SEED AUDIT');
say(`generated ${new Date().toISOString().slice(0, 10)} from seed.json`);

rule('1. SHAPE');
say(`people        ${seed.people.length}`);
say(`stage_groups  ${seed.stage_groups.length}`);
say(`substages     ${seed.substages.length}`);
say(`projects      ${seed.projects.length}`);
const totalPs = seed.projects.reduce((n, p) => n + p.substages.length, 0);
const totalDel = seed.substages.reduce((n, s) => n + s.deliverables.length, 0);
say(`project_substage rows implied  ${totalPs}`);
say(`deliverables (taxonomy)        ${totalDel}`);

rule('2. ASSIGNMENTS PER PERSON');
const perPerson = new Map(seed.people.map((n) => [n, []]));
const unknownPeople = new Map();
for (const p of seed.projects) {
  for (const [person, code] of Object.entries(p.assignments)) {
    if (!perPerson.has(person)) {
      if (!unknownPeople.has(person)) unknownPeople.set(person, []);
      unknownPeople.get(person).push(p.name);
      continue;
    }
    perPerson.get(person).push({ project: p.name, code });
  }
}
const ranked = [...perPerson.entries()].sort((a, b) => b[1].length - a[1].length);
say('person          total  non-INVOLVED-equivalent   (codes used)');
for (const [person, rows] of ranked) {
  // '.' reads as advisory oversight in the sheet; '-' reads as no role recorded.
  const real = rows.filter((r) => r.code !== '.').length;
  const codes = [...new Set(rows.map((r) => r.code))].sort().join(' ');
  say(`${person.padEnd(15)} ${String(rows.length).padStart(3)}   ${String(real).padStart(3)}                       ${codes}`);
}
say();
say(`projects with zero assignments: ${seed.projects.filter((p) => Object.keys(p.assignments).length === 0).length}`);
for (const p of seed.projects.filter((x) => Object.keys(x.assignments).length === 0)) {
  say(`  sl ${String(p.sl).padStart(2)}  ${p.name}`);
}
if (unknownPeople.size) {
  say();
  say('assignments naming someone absent from people[]:');
  for (const [n, ps] of unknownPeople) say(`  ${n}: ${ps.join(', ')}`);
}

rule('3. ROLE CODES  [blocker check]');
const codeUse = new Map();
for (const p of seed.projects) {
  for (const [person, code] of Object.entries(p.assignments)) {
    if (!codeUse.has(code)) codeUse.set(code, []);
    codeUse.get(code).push(`${person} / ${p.name}`);
  }
}
say('code   count   valid per schema check constraint');
for (const [code, uses] of [...codeUse.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const ok = ROLE_CODES.includes(code);
  say(`${JSON.stringify(code).padEnd(7)}${String(uses.length).padStart(4)}    ${ok ? 'yes' : 'NO  <-- will violate assignments_role_code_check'}`);
}
const badCodes = [...codeUse.keys()].filter((c) => !ROLE_CODES.includes(c));
if (badCodes.length) {
  blockers.push(
    `Role codes ${badCodes.map((c) => JSON.stringify(c)).join(', ')} are used in the seed but are not in ` +
    `the schema's allowed set (${ROLE_CODES.join(', ')}). ` +
    `${codeUse.get('.')?.length ?? 0} rows use ".", ${codeUse.get('-')?.length ?? 0} use "-", ` +
    `${codeUse.get('ID')?.length ?? 0} use "ID". Every one of these inserts fails until they are mapped.`
  );
}

rule('4. SUBSTAGE TAXONOMY  [blocker check]');
const byName = new Map();
for (const s of seed.substages) {
  const key = `${s.group} :: ${s.name}`;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(s);
}
const ambiguous = [...byName.entries()].filter(([, v]) => v.length > 1);
const dupNameDiffGroup = new Map();
for (const s of seed.substages) {
  if (!dupNameDiffGroup.has(s.name)) dupNameDiffGroup.set(s.name, []);
  dupNameDiffGroup.get(s.name).push(s.group);
}
say('substage names appearing more than once:');
for (const [name, groups] of dupNameDiffGroup) {
  if (groups.length > 1) say(`  "${name}" x${groups.length}  ->  ${groups.join(' | ')}`);
}
if (ambiguous.length) {
  say();
  for (const [key, rows] of ambiguous) {
    say(`AMBIGUOUS: "${key}" exists ${rows.length} times in the SAME stage group (seq ${rows.map((r) => r.seq).join(', ')})`);
  }
  blockers.push(
    ambiguous.map(([key, rows]) =>
      `"${key}" appears ${rows.length} times inside one stage group (seq ${rows.map((r) => r.seq).join(' and ')}). ` +
      `Project rows reference substages by (group, name) only, so they cannot be resolved to a substage id. ` +
      `Spec section 6.6 says show the stage group next to the name - that does not disambiguate these two.`
    ).join(' ')
  );
}

sub('planned_weeks values');
const pw = new Map();
for (const s of seed.substages) {
  const k = `${JSON.stringify(s.planned_weeks)} (${typeof s.planned_weeks})`;
  pw.set(k, (pw.get(k) ?? 0) + 1);
}
for (const [k, n] of [...pw.entries()].sort()) say(`  ${k.padEnd(24)} x${n}`);
const nonNumeric = seed.substages.filter(
  (s) => s.planned_weeks !== null && typeof s.planned_weeks !== 'number'
);
if (nonNumeric.length) {
  blockers.push(
    `planned_weeks is the string ${nonNumeric.map((s) => JSON.stringify(s.planned_weeks)).join(', ')} on ` +
    `${nonNumeric.map((s) => s.name).join(', ')}. The column is numeric; this must become null.`
  );
}
const noPlan = seed.substages.filter((s) => typeof s.planned_weeks !== 'number');
decisions.push(
  `${noPlan.length} of ${seed.substages.length} substages have no planned_weeks. ` +
  `days_over is null whenever planned_weeks is null, so the board cannot rank any project whose current ` +
  `substage is one of these: ${noPlan.map((s) => s.name).join(', ')}.`
);

rule('5. PROJECT SUBSTAGE ROWS  [blocker check]');
const statusUse = new Map();
let concludedWithoutDone = 0;
const noteRows = [];
const orphanRefs = [];
const dupRefs = [];
for (const p of seed.projects) {
  const seen = new Set();
  for (const r of p.substages) {
    statusUse.set(r.status, (statusUse.get(r.status) ?? 0) + 1);
    const key = `${r.group} :: ${r.substage}`;
    if (!byName.has(key)) orphanRefs.push(`${p.name}: ${key}`);
    if (seen.has(key)) dupRefs.push(`${p.name}: ${key}`);
    seen.add(key);
    if (r.concluded_on && r.status !== 'done') concludedWithoutDone++;
    if (r.note) noteRows.push(`${p.name} / ${r.substage}: ${JSON.stringify(r.note)}`);
  }
}
say('status   count   valid per project_substage check constraint');
for (const [s, n] of [...statusUse.entries()].sort((a, b) => b[1] - a[1])) {
  const ok = SUBSTAGE_STATUSES.includes(s);
  say(`${s.padEnd(12)}${String(n).padStart(4)}    ${ok ? 'yes' : 'NO  <-- will violate the check constraint'}`);
}
const badStatuses = [...statusUse.keys()].filter((s) => !SUBSTAGE_STATUSES.includes(s));
if (badStatuses.length) {
  blockers.push(
    `project_substage.status values ${badStatuses.map((s) => JSON.stringify(s)).join(', ')} ` +
    `(${badStatuses.reduce((n, s) => n + statusUse.get(s), 0)} rows) are not in the allowed set. ` +
    `These are cells the spreadsheet had a date in but no colour.`
  );
}
if (dupRefs.length) {
  say();
  say('duplicate (project, group, substage) references - collide on unique(project_id, substage_id):');
  for (const d of dupRefs) say(`  ${d}`);
}
if (orphanRefs.length) {
  say();
  say('references to a substage not in the taxonomy:');
  for (const d of orphanRefs) say(`  ${d}`);
}
say();
say(`rows with concluded_on but status <> 'done': ${concludedWithoutDone}`);
say(`rows carrying a free-text note:              ${noteRows.length}`);
for (const n of noteRows) say(`  ${n}`);
if (noteRows.length) {
  blockers.push(
    `${noteRows.length} substage row(s) carry a note the schema has nowhere to put ` +
    `(project_substage has no note column): ${noteRows.join('; ')}.`
  );
}

sub('started_on coverage - this drives the whole board');
const withConcluded = seed.projects.flatMap((p) => p.substages.filter((r) => r.concluded_on));
say(`rows with concluded_on: ${withConcluded.length}`);
say(`rows with started_on:   0   (the seed has no start dates at all)`);
const inProcess = seed.projects.filter((p) => p.substages.some((r) => r.status === 'in_process'));
say();
say(`projects with at least one in_process substage: ${inProcess.length} of ${seed.projects.length}`);
say(`=> v_board.days_in_substage and days_over will be NULL for all ${seed.projects.length} projects on day one,`);
say(`   because both derive from started_on and nothing seeds it.`);
decisions.push(
  `No project_substage row has started_on. v_board sorts by days_over desc, so on day one every row ties ` +
  `at null and the board's headline number is blank for all ${seed.projects.length} projects. ` +
  `Phase 5's acceptance test ("the top row is a project you already knew was stuck") cannot pass from seeded ` +
  `data - only from statuses flipped inside the app afterwards.`
);

rule('6. PROJECTS WITH NO SUBSTAGE DATA  [spec section 6.1]');
const empty = seed.projects.filter((p) => p.substages.length === 0);
say(`${empty.length} of ${seed.projects.length} projects have zero substage rows:`);
for (const p of empty) {
  const team = Object.entries(p.assignments).map(([k, v]) => `${k}:${v}`).join(', ') || 'nobody assigned';
  say(`  sl ${String(p.sl).padStart(2)}  ${p.type}  ${p.name.padEnd(30)} ${team}`);
}
decisions.push(
  `${empty.length} of ${seed.projects.length} projects have no substage data. CLAUDE.md says show them as ` +
  `"Not set" and never hide them; spec 6.1 says decide per project whether to track it. Both can hold, but ` +
  `someone has to say which of these ${empty.length} are live work and which are dormant enquiries.`
);

rule('7. PROJECT FIELDS  [spec section 6.2-6.4]');
sub('type');
const types = new Map();
for (const p of seed.projects) types.set(p.type, (types.get(p.type) ?? 0) + 1);
for (const [t, n] of types) say(`  ${t}  ${n}  ${PROJECT_TYPES.includes(t) ? '' : '<-- invalid'}`);

sub('status');
const pstat = new Map();
for (const p of seed.projects) pstat.set(String(p.status), (pstat.get(String(p.status)) ?? 0) + 1);
for (const [s, n] of pstat) {
  const norm = s === 'null' ? null : s.toLowerCase();
  const ok = norm !== null && PROJECT_STATUSES.includes(norm);
  say(`  ${s.padEnd(10)} ${String(n).padStart(2)}  ${ok ? 'maps to ' + norm : s === 'null' ? 'NULL - column is NOT NULL, needs a default' : 'invalid'}`);
}
const nullStatus = seed.projects.filter((p) => p.status === null);
if (nullStatus.length) {
  blockers.push(
    `${nullStatus.length} projects have status null (${nullStatus.map((p) => p.name).join(', ')}) but ` +
    `projects.status is NOT NULL. They default to 'ongoing' unless told otherwise - and all ${nullStatus.length} ` +
    `look like enquiries, not live jobs.`
  );
}

sub('priority');
const prio = new Map();
for (const p of seed.projects) prio.set(String(p.priority), (prio.get(String(p.priority)) ?? 0) + 1);
for (const [k, n] of [...prio.entries()].sort()) {
  say(`  priority ${k.padEnd(6)} ${String(n).padStart(2)}  ${((n / seed.projects.length) * 100).toFixed(0)}%`);
}
const modal = [...prio.entries()].sort((a, b) => b[1] - a[1])[0];
decisions.push(
  `priority = ${modal[0]} on ${modal[1]} of ${seed.projects.length} projects (${((modal[1] / seed.projects.length) * 100).toFixed(0)}%). ` +
  `A field where that many rows share one value cannot order anything. Spec 6.2: redefine the scale or drop the column.`
);

sub('code and site_location');
const withCode = seed.projects.filter((p) => p.code);
const withSite = seed.projects.filter((p) => p.site_location);
say(`  code present:          ${withCode.length} of ${seed.projects.length}`);
say(`  site_location present: ${withSite.length} of ${seed.projects.length}`);
say(`  client_name present:   ${seed.projects.filter((p) => p.client_name).length} of ${seed.projects.length}`);
say();
say('  Note: seed.json carries no code, client_name or site_location field at all.');
say('  Spec 6.3 says codes exist for 13 of 37 - they did not survive the decode.');
decisions.push(
  `seed.json has no code, client_name or site_location for any project. Spec 6.3 says 13 codes exist in the ` +
  `spreadsheet; they were not decoded. Either re-extract them or the columns ship empty.`
);

rule('8. NAMES AND IDENTIFIERS  [spec section 6.5]');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const groups = new Map();
for (const p of seed.projects) {
  const k = norm(p.name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}
say('exact duplicate names after normalisation:');
let exact = 0;
for (const [, rows] of groups) {
  if (rows.length > 1) { exact++; say(`  ${rows.map((r) => `sl ${r.sl} "${r.name}" (${r.type})`).join('  ==  ')}`); }
}
if (!exact) say('  none');

// Levenshtein for near-duplicates.
const lev = (a, b) => {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
};
say();
say('near-duplicate names (edit distance <= 2 on normalised name):');
const near = [];
const keys = [...groups.keys()];
for (let i = 0; i < keys.length; i++)
  for (let j = i + 1; j < keys.length; j++) {
    const d = lev(keys[i], keys[j]);
    if (d > 0 && d <= 2) {
      const a = groups.get(keys[i])[0], b = groups.get(keys[j])[0];
      near.push(`  sl ${a.sl} "${a.name}" (${a.type})  ~  sl ${b.sl} "${b.name}" (${b.type})   distance ${d}`);
    }
  }
say(near.length ? near.join('\n') : '  none');
if (near.length) {
  decisions.push(`Near-duplicate project names, probably one client each: ${near.map((s) => s.trim()).join(' | ')}.`);
}

sub('sl numbers');
const sls = seed.projects.map((p) => p.sl);
const dupSl = [...new Set(sls.filter((s, i) => sls.indexOf(s) !== i))];
say(`  range ${Math.min(...sls)}..${Math.max(...sls)}, ${seed.projects.length} rows`);
say(`  duplicated sl: ${dupSl.length ? dupSl.join(', ') : 'none'}`);
for (const d of dupSl) say(`    sl ${d}: ${seed.projects.filter((p) => p.sl === d).map((p) => p.name).join('  |  ')}`);
const missing = [];
for (let i = Math.min(...sls); i <= Math.max(...sls); i++) if (!sls.includes(i)) missing.push(i);
say(`  missing sl:    ${missing.length ? missing.join(', ') : 'none'}`);
say('  (sl is a spreadsheet row label, not a key. The schema uses uuids and does not store it.)');

sub('malformed text');
const malformed = [];
for (const s of seed.substages) {
  if (/\?{2,}/.test(s.name)) malformed.push(`substage name: "${s.name}"`);
  for (const d of s.deliverables) {
    if (/\?{2,}/.test(d)) malformed.push(`deliverable of "${s.name}": "${d}"`);
    if (/\b(Structual|Staricase|Intgration|Clearence|OPTIMZATION|Muskesh)\b/i.test(d)) malformed.push(`typo in deliverable: "${d}"`);
  }
}
for (const s of seed.substages) if (/OPTIMZATION/i.test(s.name)) malformed.push(`typo in substage name: "${s.name}"`);
for (const d of ["BATHROOM GF'S"]) {
  if (seed.substages.some((s) => s.deliverables.includes(d))) malformed.push(`ambiguous abbreviation: "${d}" (GFC?)`);
}
say(malformed.length ? malformed.map((m) => '  ' + m).join('\n') : '  none');

rule('9. STAGE GROUPS');
say(`seed has ${seed.stage_groups.length} stage groups; CLAUDE.md says "one of 8 phases".`);
seed.stage_groups.forEach((g, i) => {
  const n = seed.substages.filter((s) => s.group === g.name).length;
  say(`  seq ${i}  ${g.name.padEnd(24)} ${n} substage(s)`);
});
say();
say('stage_groups.seq is NOT in seed.json - it is derived from array order above.');
say('v_board picks the current substage by (stage_group.seq, substage.seq), so this order is load-bearing.');
if (seed.stage_groups.length !== 8) {
  decisions.push(
    `seed.json has ${seed.stage_groups.length} stage groups; CLAUDE.md says 8. Either a group was lost in the ` +
    `decode or the doc is stale. The count matters because stage_group order decides which substage the board shows.`
  );
}

rule('10. VERIFYING THE SPEC\'S OWN ACCEPTANCE NUMBERS');
const madhu = perPerson.get('Madhu') ?? [];
const selva = perPerson.get('Selva') ?? [];
say(`Spec Phase 1 acceptance: "counting active assignments per person returns Madhu = 14".`);
say(`Spec Team-load screen:   "Madhu is on 14 of 37 projects and Selva, the next highest, is on 7".`);
say();
say(`  Madhu, all assignment rows in seed:            ${madhu.length}`);
say(`  Madhu, excluding role "." (advisory):          ${madhu.filter((r) => r.code !== '.').length}`);
say(`  Madhu, excluding "." and "-":                  ${madhu.filter((r) => r.code !== '.' && r.code !== '-').length}`);
say(`  Selva, all assignment rows in seed:            ${selva.length}`);
say(`  Selva, excluding "." and "-":                  ${selva.filter((r) => r.code !== '.' && r.code !== '-').length}`);
say();
const madhuReal = madhu.filter((r) => r.code !== '.' && r.code !== '-').length;
if (madhuReal === 14) {
  say(`  => "Madhu = 14" holds only when "." and "-" are treated as non-work roles.`);
  say(`     That is the definition the seed script and the Team-load screen must both use.`);
} else {
  say(`  => No reading of this seed gives Madhu = 14 (closest: ${madhuReal}). The acceptance number is wrong,`);
  say(`     or it was counted against a different version of the spreadsheet.`);
}
decisions.push(
  `Spec Phase 1 acceptance is "Madhu = 14". Seed gives Madhu ${madhu.length} rows total, ` +
  `${madhu.filter((r) => r.code !== '.').length} excluding ".", ${madhuReal} excluding "." and "-". ` +
  `Pick the definition before writing the seed script, because it is also the Team-load screen's definition.`
);

rule('BLOCKERS - these fail an insert or load ambiguously');
if (!blockers.length) say('none');
blockers.forEach((b, i) => { say(); say(`B${i + 1}. ${b}`); });

rule('DECISIONS FOR THE FIRM - these load fine but the value is wrong or useless');
decisions.forEach((d, i) => { say(); say(`D${i + 1}. ${d}`); });

say();
say('='.repeat(78));
say(`${blockers.length} blockers, ${decisions.length} decisions. Nothing enters a database until both lists are closed.`);
say('='.repeat(78));

const text = out.join('\n');
console.log(text);
if (process.argv.includes('--write')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(root, 'docs', 'PHASE0_AUDIT.txt'), text + '\n');
  console.error('\nwrote docs/PHASE0_AUDIT.txt');
}
