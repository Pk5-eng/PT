# Kabra Architects Project Dashboard: Build Spec

Hand this file, `CLAUDE.md` and `seed.json` to Claude Code. Work one phase per session.

## 1. What this replaces

A spreadsheet (`KA_WORK_DISTRIBUTION.xlsx`) where the status of every substage on every
project is stored as a cell background colour: salmon `F4B083` = done, yellow `FFE598` =
in process, dark orange `C55A11` = cancelled, no fill = not in scope. That data cannot be
queried, sorted, counted or audited, and it is destroyed by copy-paste. `seed.json` contains
it decoded into text.

The firm: 10 people, 37 projects, Bangalore. Users are architects, not software people, and
half of them will use this standing on a site with one hand.

## 2. App type and cost

**Installable PWA. Not a native app.**

A React SPA with a web manifest and a service worker, installed to the home screen from the
browser. It gets an icon, launches without browser chrome, and works offline for reading.

This is not a compromise, it is the only option that meets the zero-cost constraint. Native
distribution requires an Apple Developer account (99 USD per year, recurring) and a Google Play
account (25 USD one time), plus build infrastructure. A PWA costs nothing and updates the moment
you push to the repo, with no review queue.

The one real limitation: no push notifications on iOS below 16.4, and no access to native
storage or camera APIs beyond what the browser exposes. Neither matters here, because
notifications are explicitly out of scope for v1.

**Hosting:** Cloudflare Pages, free tier, commercial use permitted.
**Data:** Supabase, free tier. Hosted Postgres, Auth, Row Level Security.
**No backend server exists.** The browser talks to Postgres through Supabase's PostgREST
layer, and RLS is the authorisation boundary. Nothing runs between deploys. Nothing to pay for.

Do not use Vercel. Its Hobby tier is licensed for non-commercial use and this is a business tool.

**Stack:** React 18, Vite, `@supabase/supabase-js`, `date-fns`, `vite-plugin-pwa`.
That is the complete dependency list. Adding to it requires asking first.

## 3. Schema

Run this as the first migration. It is written to be pasted into the Supabase SQL editor.

```sql
create extension if not exists "pgcrypto";

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  name text not null,
  email text unique,
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  client_name text,
  type text not null check (type in ('AR','ID','IR')),
  status text not null default 'ongoing'
    check (status in ('ongoing','hold','npp','not_confirmed','completed','cancelled')),
  priority int check (priority between 0 and 3),
  site_location text,
  created_at timestamptz not null default now(),
  created_by uuid references people(id)
);

create table stage_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seq int not null,
  active boolean not null default true
);

create table substages (
  id uuid primary key default gen_random_uuid(),
  stage_group_id uuid not null references stage_groups(id),
  name text not null,
  seq int not null,
  planned_weeks numeric,
  active boolean not null default true
);

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  substage_id uuid not null references substages(id),
  name text not null,
  seq int not null default 0,
  active boolean not null default true
);

create table project_substage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid not null references substages(id),
  status text not null default 'not_started'
    check (status in ('not_in_scope','not_started','in_process','done','hold','cancelled')),
  started_on date,
  concluded_on date,
  unique (project_id, substage_id)
);

create table project_deliverable (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  deliverable_id uuid not null references deliverables(id),
  done boolean not null default false,
  done_on date,
  unique (project_id, deliverable_id)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id),
  role_code text not null check (role_code in ('PI','DD','WD','PE','CL','INVOLVED')),
  unique (project_id, person_id)
);

create table blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  owner text not null check (owner in ('client','authority','consultant','contractor','internal')),
  reason text not null,
  raised_on date not null default current_date,
  raised_by uuid references people(id),
  cleared_on date
);

create table events (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid references substages(id),
  actor_id uuid references people(id),
  from_status text,
  to_status text,
  at timestamptz not null default now()
);

create index on project_substage (project_id);
create index on events (project_id, at desc);
create index on assignments (person_id);
```

### The trigger that makes this work

Users never type dates. The database stamps them.

```sql
create or replace function stamp_and_log() returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_process' and new.started_on is null then
      new.started_on := current_date;
    end if;
    if new.status = 'done' and new.concluded_on is null then
      new.concluded_on := current_date;
    end if;
    if new.status <> 'done' then
      new.concluded_on := null;
    end if;
    insert into events (project_id, substage_id, actor_id, from_status, to_status)
    values (new.project_id, new.substage_id,
            (select id from people where auth_id = auth.uid()),
            old.status, new.status);
  end if;
  return new;
end $$ language plpgsql security definer;

create trigger trg_stamp_and_log
  before update on project_substage
  for each row execute function stamp_and_log();
```

### Board view

```sql
create or replace view v_board as
with current_sub as (
  select distinct on (ps.project_id)
    ps.project_id, ps.substage_id, ps.status, ps.started_on,
    s.name as substage_name, s.planned_weeks, sg.name as stage_group_name
  from project_substage ps
  join substages s on s.id = ps.substage_id
  join stage_groups sg on sg.id = s.stage_group_id
  where ps.status = 'in_process'
  order by ps.project_id, sg.seq, s.seq
)
select
  p.id, p.name, p.code, p.type, p.status, p.priority,
  c.substage_name, c.stage_group_name, c.planned_weeks,
  c.started_on,
  case when c.started_on is null then null
       else current_date - c.started_on end as days_in_substage,
  case when c.started_on is null or c.planned_weeks is null then null
       else (current_date - c.started_on) - round(c.planned_weeks * 7) end as days_over,
  (select b.owner from blocks b
    where b.project_id = p.id and b.cleared_on is null
    order by b.raised_on limit 1) as blocked_by
from projects p
left join current_sub c on c.project_id = p.id;
```

A project with no `in_process` substage returns nulls and shows as "Not set" on the board.
That is intended. Twenty of the thirty-seven projects will look like this on day one, and
hiding them would defeat the point.

### Row Level Security

```sql
alter table projects enable row level security;
alter table project_substage enable row level security;
alter table assignments enable row level security;
alter table blocks enable row level security;
alter table events enable row level security;
alter table substages enable row level security;
alter table stage_groups enable row level security;
alter table deliverables enable row level security;
alter table people enable row level security;
```

Policies, stated in plain terms for Claude Code to implement:

- Any authenticated user reads every table.
- Any authenticated user may insert and update `projects`, `project_substage`,
  `project_deliverable`, `assignments`, `blocks`.
- Only a person whose `role = 'admin'` may insert or update `stage_groups`, `substages`,
  `deliverables`, `people`.
- Nobody deletes `substages`, `stage_groups`, `deliverables` or `events`. Revoke delete
  entirely on those four tables. Deactivation is `active = false`.
- `events` accepts inserts only from the trigger. No client insert policy.

## 4. Screens

Four. Adding a fifth needs a reason that survived a month of daily use.

### Board (default route)

Header: filter by person, filter by type, "New project" button.
Three summary cards: live projects, count past planned duration, count blocked.
Table sorted by `days_over` descending, nulls last.

Columns: project (name plus type and code beneath), current substage, `days / plan` as two
numbers in one cell, blocked by, team.

Colour reinforces the numbers, it never carries meaning alone. The screen must be readable
printed in black and white. No progress bars. No percent complete. No charts.

Mobile below 640px: the table becomes stacked cards. Project name and the days figure on the
top line, substage and blocker beneath.

### Project detail

Header with inline-editable name, code, client, type, status, priority, site location.
Click a field, edit it, blur to save. No edit mode, no save button.

Active block shown as a banner with a Clear action. Raise-block control beneath.

Then all in-scope substages as a flat list grouped by stage group. Each row: status icon,
substage name, one line of metadata (`started 4 Mar, 48 days, plan 11`), and a status dropdown
on the right. The dropdown is the entire editing interaction. Changing it triggers the database
stamp and writes an event.

Expanding a substage row reveals its deliverable checklist.

Activity feed at the bottom, read from `events`, newest first.

### New project

One form. Name, client, code, type, priority, site location, assignments, and a checklist of
which substages are in scope (default all active ones). Nothing else.

Acceptance: a new project takes under sixty seconds to create on a phone.

### Team load

One horizontal bar per person, count of active assignments where `role_code` is not `INVOLVED`.
This screen exists because Madhu is currently on 14 of 37 projects and Selva, the next highest,
is on 7. Do not soften this view.

### Settings (admin only)

Taxonomy editing. Deliberately plainer than the other screens: this is visited four times a
year, not four times a week.

Stage groups and substages as a reorderable list. Editable name, editable `planned_weeks`,
drag to reorder, Archive button. Deliverables nested under each substage. People list with
name, email, role, active toggle.

Three rules the UI must enforce:

1. **No delete, only archive.** A substage with events against it is history. Archiving hides
   it from new projects and leaves it visible on old ones.
2. **A substage cannot change stage group** once any `project_substage` row exists for it.
   Grey the control and say why. Create a new substage instead.
3. **Renaming, reordering and changing planned weeks are all safe** and need no warning.

## 5. Build phases

Each phase ends with something you can open in a browser. Do not begin the next phase until the
current one is deployed and you have used it for real.

**Phase 0. Repo and audit.** Repo created, `CLAUDE.md` and `seed.json` in root. Claude Code reads
the seed and prints: assignments per person, projects with zero substage rows, duplicate or
malformed names. You review and decide the fixes in section 6 before anything enters a database.

**Phase 1. Schema and seed.** Supabase project created, the SQL above applied, a Node script loads
`seed.json`. Acceptance: a SQL query in the Supabase console counting active assignments per
person returns Madhu = 14.

**Phase 2. Read-only board.** Vite app, Supabase client, board screen reading `v_board`. No editing.
Deployed to Cloudflare Pages. Acceptance: you open the URL on your phone and see all 37 projects.

**Phase 3. Project detail and status editing.** Substage list with working dropdowns, deliverable
checklists, activity feed. Acceptance: you change a status, reload, and the date is there without
anyone having typed it.

**Phase 4. New project and inline field editing.** Acceptance: you create a project in under a
minute on a phone.

**Phase 5. Blocks, team load, derived metrics.** Acceptance: the board sorts by longest overrun and
the top row is a project you already knew was stuck.

**Phase 6. Auth, RLS and PWA install.** Supabase email auth restricted to your firm domain, all
policies applied, manifest and service worker so the app installs to a home screen. Acceptance:
logging in from an outside address returns nothing, and the app icon sits on your phone.

## 6. Fix in the source data before Phase 1

1. Twenty of 37 projects have no substage data. Decide per project: track it, or move it out of
   the live list.
2. Priority is 3 for 25 of 37 projects. A field where two thirds of rows share a value carries
   no information. Redefine the scale or drop the column.
3. Project codes exist for 13 of 37. Either every project gets one or the field goes.
4. Site location is empty for all 37. Fill it or drop it.
5. `Mukesh Gala` and `Muskesh Gala` are two rows and probably one client.
6. `MATERIAL SELECTION` appears three times under different stage groups. Correct in the database,
   but the UI must always show the stage group name alongside the substage or nobody will know
   which one they are ticking.

## 7. Working with Claude Code

- Give it the acceptance criterion, not the implementation.
- After every phase, make it run the app and describe what it sees before you look. A wrong
  description means wrong code.
- No new dependencies without asking.
- A phase taking more than two sessions was too big. Split it rather than pushing through.
- Never let it write a migration that drops or alters an existing column without showing you
  the SQL first.

Opening prompt for Phase 1:

> Read CLAUDE.md, KA_DASHBOARD_BUILD_SPEC.md and seed.json. Apply the migration in spec section 3
> to my Supabase project, then write a Node seed script that loads seed.json into people,
> stage_groups, substages, deliverables, projects, project_substage and assignments. Substage
> status comes from the status field in the seed. Do not invent rows for projects that have no
> substage entries. When done, give me the SQL that counts active assignments per person so I can
> verify Madhu returns 14.

## 8. Out of scope for v1

Gantt charts. Percent complete. Time tracking. Client login. File storage. Notifications.
Invoicing. Fee and payment tracking.

Each of these has killed a small-firm dashboard before. Add one only after the board has been in
daily use for a month and its absence is causing real pain.
