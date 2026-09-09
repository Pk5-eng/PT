-- READY.sql
--
-- One row, one word: READY or BEHIND. Two readers:
--
--   the migrate workflow, which fails the run if the answer is not READY, so a
--     migration that half-applied cannot pass unnoticed;
--   a person, who can paste it into the SQL editor for a fast answer without
--     reading the whole of VERIFY.sql.
--
-- Counted from the catalogue rather than from schema_migrations on purpose. The
-- ledger records what was *run*; this checks what is actually *there*. A ledger
-- row written by a migration that was later rolled back, or a table dropped by
-- hand afterwards, cannot make this say READY.
--
-- The numbers below are asserted by test/converge.sh against a real database in
-- three different states, so they cannot quietly drift away from the schema.

select
  case when tables = 12 and board_columns = 7 and functions = 7
       then 'READY'
       else 'BEHIND'
            || ' (tables ' || tables || '/12'
            || ', board columns ' || board_columns || '/7'
            || ', functions ' || functions || '/7)'
  end as verdict
from (
  select
    (select count(*) from information_schema.tables where table_schema = 'public'
      and table_name in ('people','projects','stage_groups','substages','deliverables',
                         'project_substage','project_deliverable','assignments','blocks',
                         'events','project_stage_group','schema_migrations')) as tables,
    (select count(*) from information_schema.columns where table_name = 'v_board'
      and column_name in ('target_delivery','days_to_delivery','section_target',
                          'days_past_section','in_scope_count','started_count',
                          'planned_days')) as board_columns,
    (select count(*) from pg_proc where proname in
      ('stamp_and_log','is_admin','link_my_identity','stamp_deliverable',
       'working_days','planned_working_days','ensure_project_structure')) as functions
) n;
