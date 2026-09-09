-- 0001_schema.sql
-- Base schema, verbatim from KA_DASHBOARD_BUILD_SPEC.md section 3.
-- Apply first, in the Supabase SQL editor or via the CLI.

-- Wrapped in a transaction: if any statement fails the whole file rolls back,
-- rather than leaving the schema half-applied.
begin;

create extension if not exists "pgcrypto";

-- Which migrations this database has had applied. Not a gate - every migration
-- in this directory is idempotent and re-running one is a no-op - but a record,
-- so VERIFY.sql can answer "is this database current?" without anyone having to
-- remember. Kept out of PostgREST entirely: it is operational metadata and no
-- browser has any business reading it.
create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;
revoke all on schema_migrations from anon, authenticated;

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  name text not null,
  email text unique,
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true
);

create table if not exists projects (
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

create table if not exists stage_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seq int not null,
  active boolean not null default true
);

create table if not exists substages (
  id uuid primary key default gen_random_uuid(),
  stage_group_id uuid not null references stage_groups(id),
  name text not null,
  seq int not null,
  planned_weeks numeric,
  active boolean not null default true
);

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  substage_id uuid not null references substages(id),
  name text not null,
  seq int not null default 0,
  active boolean not null default true
);

create table if not exists project_substage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid not null references substages(id),
  status text not null default 'not_started'
    check (status in ('not_in_scope','not_started','in_process','done','hold','cancelled')),
  started_on date,
  concluded_on date,
  unique (project_id, substage_id)
);

create table if not exists project_deliverable (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  deliverable_id uuid not null references deliverables(id),
  done boolean not null default false,
  done_on date,
  unique (project_id, deliverable_id)
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  person_id uuid not null references people(id),
  role_code text not null check (role_code in ('PI','DD','WD','PE','CL','INVOLVED')),
  unique (project_id, person_id)
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  owner text not null check (owner in ('client','authority','consultant','contractor','internal')),
  reason text not null,
  raised_on date not null default current_date,
  raised_by uuid references people(id),
  cleared_on date
);

create table if not exists events (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  substage_id uuid references substages(id),
  actor_id uuid references people(id),
  from_status text,
  to_status text,
  at timestamptz not null default now()
);

create index if not exists project_substage_project_id_idx
  on project_substage (project_id);
create index if not exists events_project_id_at_idx
  on events (project_id, at desc);
create index if not exists assignments_person_id_idx
  on assignments (person_id);

-- Not in the spec's SQL, but the taxonomy is looked up by (stage_group, name)
-- during seeding and by seq on every board read.
create index if not exists substages_stage_group_id_seq_idx
  on substages (stage_group_id, seq);
create index if not exists deliverables_substage_id_seq_idx
  on deliverables (substage_id, seq);

insert into schema_migrations (version) values ('0001_schema')
  on conflict (version) do nothing;

commit;
