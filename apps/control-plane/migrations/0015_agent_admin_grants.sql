-- 0015_agent_admin_grants.sql — die Freigaben auf den Wert aus 0014.
--
-- Ohne diese zwei Zeilen koennte nach 0014 niemand eine Agent-Identitaet
-- anlegen, auch kein Plattform-Administrator: Default-Deny gilt fuer die neue
-- Ressourcenart wie fuer jede andere.
--
-- Kein `execute`: Eine Identitaet wird gelesen und geaendert, nicht
-- ausgefuehrt. Was der Agent selbst darf, steht nicht hier, sondern in den
-- Freigaben, die er als **Subjekt** bekommt — eine neue Identitaet hat keine.

INSERT INTO grants (subject_kind, subject_id, verb, resource_kind, resource_id, granted_by)
VALUES
  ('group', 'platform-admins', 'read',  'agent', '*', 'system:bootstrap'),
  ('group', 'platform-admins', 'write', 'agent', '*', 'system:bootstrap')
ON CONFLICT DO NOTHING;
