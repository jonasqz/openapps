-- 0006_app_roles.sql — Rollen-Anlage pro App und der Bootstrap-Grant.
--
-- Harte Regel: eine App-Rolle hat NIE BYPASSRLS und NIE SUPERUSER. Sie darf
-- sich nicht anmelden ausser mit dem von der Control Plane gesetzten Passwort,
-- sie sieht genau ein Schema, und sie erbt nichts von anderen Rollen.
-- Wer diese Funktion aendert, aendert die Grundlage von DoD 3.

CREATE OR REPLACE FUNCTION provision_app_schema(
  p_schema_name text,
  p_role_name   text,
  p_password    text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_schema_name !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'ungueltiger Schema-Name: %', p_schema_name;
  END IF;
  IF p_role_name !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'ungueltiger Rollen-Name: %', p_role_name;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role_name) THEN
    -- NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT: explizit,
    -- damit eine Aenderung der Server-Defaults nichts aufweicht.
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
      p_role_name, p_password
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
      p_role_name, p_password
    );
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', p_schema_name, p_role_name);

  -- Kein Zugriff auf public, kein Durchgriff auf Schemata anderer Apps.
  EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', p_role_name);
  EXECUTE format('ALTER ROLE %I SET search_path = %I', p_role_name, p_schema_name);
END;
$$;

REVOKE ALL ON FUNCTION provision_app_schema(text, text, text) FROM PUBLIC;

-- Bootstrap: ohne eine erste Freigabe kann niemand etwas anlegen, weil alles
-- default-deny ist. Diese eine Zeile ist der Einstieg und ist widerrufbar wie
-- jede andere Freigabe. Die Gruppe kommt aus dem SSO.
INSERT INTO grants (subject_kind, subject_id, verb, resource_kind, resource_id, granted_by)
VALUES
  ('group', 'platform-admins', 'read',    'app', '*', 'system:bootstrap'),
  ('group', 'platform-admins', 'write',   'app', '*', 'system:bootstrap'),
  ('group', 'platform-admins', 'execute', 'app', '*', 'system:bootstrap');
