-- 0013_roster.sql
--
-- The studio roster, editable from the app.
--
-- WHY
--
-- Adding or removing a studio member was an admin act performed in the Supabase
-- SQL editor, which in practice meant it was performed by nobody. The seed
-- leaves every email null, so link_my_identity() has never matched a row, no
-- browser session has ever had auth_id set, and is_admin() is therefore false
-- for everybody - including the one person the data calls an admin. A roster
-- that nobody can edit is a roster that goes stale, and a stale roster is a
-- board with a person on it who left and no way to put the new one on.
--
-- WHAT THIS OPENS
--
-- Any signed-in member may add a person to the roster, correct their name or
-- email, and archive or restore them. That is the same trust this app already
-- extends over the work itself: a member can create a project, edit any
-- project, and put anyone on or off any project. The roster is the smaller of
-- those two powers, not the larger one.
--
-- WHAT STAYS SHUT, AND WHY IT IS SHUT AT THE GRANT LEVEL
--
--   role     Not writable from the browser by anyone, admin included. A row
--            inserted here takes the column default, 'member'. Nobody can
--            promote themselves or anyone else without the SQL editor, which
--            is where every other admin act already lives.
--   auth_id  Not writable from the browser at all. It is set only by
--            link_my_identity(), which reads the email out of the JWT, so a
--            person can claim their own row and nobody else's.
--
-- Column privileges rather than policy text, because a policy can only see the
-- row and these are statements about columns. A GRANT is also the version that
-- survives someone adding a permissive policy later: the policy would widen
-- which ROWS are reachable and still not reach these two columns.
--
-- And an admin's row is not a member's to edit. Archiving the studio's only
-- admin would switch the taxonomy off for everyone and would look exactly like
-- tidying up, so the update policy lets a member edit member rows only.
--
-- NOBODY DELETES A PERSON. There is no delete policy on people, and this adds
-- none. Assignments reference a person and events reference one as the actor;
-- a delete would either fail on the reference or take that history with it.
-- Removing someone from the team is active = false - the same archive every
-- other list in this app uses, and the same reason (CLAUDE.md rule 3).

begin;

-- Insert: any signed-in member. The columns they may name are granted below.
drop policy if exists admin_write on people;
drop policy if exists write_any on people;
create policy write_any on people for insert to authenticated with check (true);

-- Update: an admin may edit any row; a member may edit rows that are not an
-- admin's. WITH CHECK repeats the test against the row as it would end up, so
-- the rule holds whichever way an edit tries to cross the line.
drop policy if exists admin_edit on people;
drop policy if exists edit_any on people;
create policy edit_any on people for update to authenticated
  using      (is_admin() or role <> 'admin')
  with check (is_admin() or role <> 'admin');

-- Supabase grants every table to `authenticated` by default, so the revoke is
-- what makes the column list below the whole list rather than an addition to
-- it. anon has no policy on people and so is already denied; revoking as well
-- means a future permissive policy cannot quietly re-open it.
revoke insert, update on people from authenticated, anon;
grant insert (name, email)         on people to authenticated;
grant update (name, email, active) on people to authenticated;

-- And the delete, made explicit. There was never a delete policy on people, so
-- a delete already removed nothing - but it removed nothing SILENTLY, matching
-- no rows and reporting success, which is the same shape as a delete that
-- worked. Revoking says it out loud, and says it at the level a later policy
-- cannot argue with. Same treatment as the taxonomy tables in 0003.
revoke delete on people from authenticated, anon;

insert into schema_migrations (version) values ('0013_roster')
  on conflict (version) do nothing;

commit;
