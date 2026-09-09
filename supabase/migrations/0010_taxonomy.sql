-- 0010_taxonomy.sql
--
-- Brings the substage taxonomy in line with the section list the studio wrote
-- out. Most of that list already existed verbatim - concept development, design
-- development, foundation, elevation, GFC-architecture and GFC-ID all matched
-- what migration 0001 and the seed already carried. Two things did not:
--
--   a. Two group names were the spreadsheet's abbreviations rather than words.
--      Renaming a stage group is safe at any time: nothing references it by
--      name except this file, and no project data is attached to the name.
--
--   b. ID-DESIGN DEVELOPMENT was listed as
--        mood board, civil drawings, component drawings & coordination,
--        material selection, services drawing
--      and held only the first of those plus two others.
--
--      The four missing ones are ADDED. The two the list did not mention -
--      SPACE OPTIMZATION IN CIVIL and INTERIOR PROPOSAL - are left active and
--      untouched: eight projects already carry rows against them, CLAUDE.md
--      rule 3 forbids deleting a substage, and archiving one that has project
--      data is a decision for the studio, made in the knowledge that it hides
--      history. Set active = false on those two if that is what is wanted.
--
-- Everything here is matched by name, never by id: seed.sql generates fresh
-- UUIDs on every run, so the ids in the repository are not the ids in the
-- database. Everything here is also idempotent and can be re-run.

begin;

update stage_groups set name = 'FOUNDATION DRAWINGS' where name = 'FOUNDATION DWGS';
update stage_groups set name = 'ELEVATION DESIGN'    where name = 'ELEVATION DESIGNING';

insert into substages (stage_group_id, name, seq, planned_weeks, active)
select g.id, v.name, v.seq, v.weeks, true
from stage_groups g
cross join (values
  ('CIVIL DRAWINGS',                    21, null::numeric),
  ('COMPONENT DRAWINGS & COORDINATION', 22, null),
  ('MATERIAL SELECTION',                23, null),
  ('SERVICES DRAWING',                  24, null)
) as v(name, seq, weeks)
where g.name = 'ID-DESIGN DEVELOPMENT'
  and not exists (
    select 1 from substages s
    where s.stage_group_id = g.id and s.name = v.name
  );

commit;
