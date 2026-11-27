-- Beispieldaten fuer Status, Projekte, Kommentare und Verlauf. Nur lokal
-- (OPENAPPS_SAMPLE_DATA=1). viewer@local.test ist die Person, als die der
-- lokale Ansichts-Proxy signiert; so zeigt "My tasks" lokal etwas.
-- Feste Ids, damit die Bezuege lesbar bleiben. Datumswerte relativ zum
-- Einspielzeitpunkt, damit "ueberfaellig" auch morgen noch stimmt.

insert into projects (id, name, description, created_by) values
  ('0e000000-0000-4000-8000-000000000001', 'Website relaunch', 'New public website, live before the spring campaign.', 'seed'),
  ('0e000000-0000-4000-8000-000000000002', 'Onboarding', 'Everything a new colleague needs in the first two weeks.', 'seed');

insert into tasks (id, title, description, status, priority, assignee, due_date, project_id, created_by) values
  ('0f000000-0000-4000-8000-000000000001', 'Write the copy for the start page',
   'Three variants of the headline, one paragraph each for the three services.',
   'in_progress', 'high', 'viewer@local.test', current_date + 3, '0e000000-0000-4000-8000-000000000001', 'seed'),
  ('0f000000-0000-4000-8000-000000000002', 'Collect photos of the team',
   '', 'todo', 'medium', 'viewer@local.test', current_date - 2, '0e000000-0000-4000-8000-000000000001', 'seed'),
  ('0f000000-0000-4000-8000-000000000003', 'Check the cookie banner with legal',
   'Legal wants to see the final wording before launch.',
   'todo', 'high', 'sam@example.com', current_date - 5, '0e000000-0000-4000-8000-000000000001', 'seed'),
  ('0f000000-0000-4000-8000-000000000004', 'Prepare laptop and accounts for the new hire',
   '', 'todo', 'medium', null, current_date + 10, '0e000000-0000-4000-8000-000000000002', 'seed'),
  ('0f000000-0000-4000-8000-000000000005', 'Update the onboarding checklist',
   '', 'todo', 'low', 'viewer@local.test', null, '0e000000-0000-4000-8000-000000000002', 'agent:operations');

insert into tasks (id, title, status, priority, assignee, project_id, completed_at, completed_by, created_by) values
  ('0f000000-0000-4000-8000-000000000006', 'Choose the hosting provider', 'done', 'medium', 'viewer@local.test',
   '0e000000-0000-4000-8000-000000000001', now() - interval '1 day', 'viewer@local.test', 'seed');

insert into task_comments (task_id, body, author) values
  ('0f000000-0000-4000-8000-000000000001', 'First draft is in the shared folder. Feedback welcome until Friday.', 'viewer@local.test'),
  ('0f000000-0000-4000-8000-000000000001', 'Looks good. The second headline reads best.', 'sam@example.com'),
  ('0f000000-0000-4000-8000-000000000003', 'Legal asked for the final text by email.', 'agent:operations');

-- Jede Aufgabe ohne Verlauf bekommt ihren Anfang, auch die aus 0001_sample.sql.
insert into task_events (task_id, kind, actor, created_at)
select id, 'created', created_by, created_at from tasks t
 where not exists (select 1 from task_events e where e.task_id = t.id);

insert into task_events (task_id, kind, from_value, to_value, actor) values
  ('0f000000-0000-4000-8000-000000000001', 'status', 'todo', 'in_progress', 'viewer@local.test'),
  ('0f000000-0000-4000-8000-000000000006', 'status', 'in_progress', 'done', 'viewer@local.test');
