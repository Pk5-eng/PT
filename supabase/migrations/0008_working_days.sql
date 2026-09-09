-- 0008_working_days.sql
--
-- The studio does not work on Sundays, so a duration measured in calendar days
-- overstates every piece of work by roughly a seventh. Asked for explicitly:
-- "in the calculation of total days spent on a project do not include sundays".
--
-- This is deliberately one function rather than a rule applied in three places.
-- The board, the project screen and the analytics screen must never disagree
-- about how long something has taken, and the only way to guarantee that is for
-- all three to read the same number out of the same view.
--
-- Counting, not eyeballing: the number of Sundays in (a, b] is the difference of
-- two floor-divisions anchored on a known Sunday. 2000-01-02 was a Sunday.
-- floor() on numeric behaves correctly for dates before the anchor; integer `/`
-- in Postgres truncates towards zero and would be wrong there, so the division
-- is done in numeric on purpose.
--
--   working_days('2026-09-07', '2026-09-14') = 7 - 1 = 6   (one Sunday between)
--
-- IMMUTABLE, and therefore usable inside a view and an index. It reads no table
-- and no clock: the caller passes current_date in, it is never read in here.

begin;

create or replace function working_days(from_date date, to_date date)
returns int as $$
  select case
    when from_date is null or to_date is null then null
    else (to_date - from_date)
       - ( floor((to_date   - date '2000-01-02') / 7.0)::int
         - floor((from_date - date '2000-01-02') / 7.0)::int )
  end;
$$ language sql immutable;

comment on function working_days(date, date) is
  'Elapsed days from from_date to to_date, excluding Sundays. The studio''s '
  'working week is six days, so this is the only day count the app shows.';

-- A planned duration is quoted in weeks and must be compared against a working
-- day count, not a calendar one, or every substage would look late by a day a
-- week. Six working days to the week.
create or replace function planned_working_days(weeks numeric)
returns int as $$
  select case when weeks is null then null else round(weeks * 6)::int end;
$$ language sql immutable;

comment on function planned_working_days(numeric) is
  'A planned duration in weeks, expressed in working days (6 per week) so it is '
  'comparable with working_days().';

revoke all on function working_days(date, date) from public, anon;
revoke all on function planned_working_days(numeric) from public, anon;
grant execute on function working_days(date, date) to authenticated;
grant execute on function planned_working_days(numeric) to authenticated;

insert into schema_migrations (version) values ('0008_working_days')
  on conflict (version) do nothing;

commit;
