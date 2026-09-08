-- 0007_deliverable_stamp.sql
--
-- Stamps project_deliverable.done_on, for the same reason stamp_and_log()
-- stamps the substage dates: rule 2, dates are never authored by a user.
--
-- Without this the browser would decide when a deliverable was finished, and a
-- client clock, a stale tab or a timezone would be able to write a date the
-- database never agreed to. Ticking the box is the whole interaction; the date
-- is a consequence of it.
--
-- Unticking clears the date rather than leaving a completion date on something
-- that is not complete.

begin;

create or replace function stamp_deliverable() returns trigger as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_on := current_date;
  elsif not new.done then
    new.done_on := null;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_stamp_deliverable on project_deliverable;

create trigger trg_stamp_deliverable
  before insert or update on project_deliverable
  for each row execute function stamp_deliverable();

commit;
