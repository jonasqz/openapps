-- 0012_group_admin_grants.sql — die Freigaben auf den Wert aus 0011.
--
-- Zweiter Teil von 0011 (die Begruendung fuer die Teilung steht dort).
--
-- `platform-admins` hat aus Migration 0006 die Wildcard auf `app:*`. Ohne
-- diese zwei Zeilen koennte nach 0011 **niemand** eine Gruppe pflegen, auch
-- kein Plattform-Administrator: Default-Deny gilt fuer die neue Ressourcenart
-- genauso wie fuer jede andere. Lieber eine Zeile zu viel in einer Migration
-- als eine Plattform, in der die Gruppenpflege nur per SQL geht — das war
-- gerade der Zustand, den 0011 beendet.
--
-- Kein `execute` auf Gruppen: Eine Gruppe wird gelesen und geaendert, nicht
-- ausgefuehrt. Eine Freigabe, die nichts bedeutet, waere eine Freigabe, die
-- jemand spaeter deutet.

INSERT INTO grants (subject_kind, subject_id, verb, resource_kind, resource_id, granted_by)
VALUES
  ('group', 'platform-admins', 'read',  'group', '*', 'system:bootstrap'),
  ('group', 'platform-admins', 'write', 'group', '*', 'system:bootstrap')
ON CONFLICT DO NOTHING;
