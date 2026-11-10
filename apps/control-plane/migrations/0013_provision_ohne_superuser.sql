-- 0013_provision_ohne_superuser.sql — Schema-Anlage und Freigaben ohne Superuser.
--
-- Der Befund: Die Control Plane laeuft im Betrieb mit einer Rolle, die
-- CREATEROLE hat, aber weder SUPERUSER noch BYPASSRLS (CLAUDE.md). Damit
-- scheitert ab Postgres 16 zweierlei, und die Tests haben beides nicht
-- gesehen, weil sie bis hierher als Superuser liefen:
--
--  1. `CREATE SCHEMA app_x AUTHORIZATION app_x` verlangt, dass die anlegende
--     Rolle zu app_x wechseln darf: „must be able to SET ROLE". Jede neue App
--     waere mit diesem Fehler abgebrochen.
--  2. `GRANT SELECT ON app_b.tabelle TO app_a` verlangt, Eigentuemer der
--     Tabelle zu sein. Die Tabelle gehoert app_b, nicht der Control Plane.
--     Postgres bricht dann nicht ab, sondern gibt nur eine WARNING („no
--     privileges were granted") — die Freigabe waere als erteilt
--     protokolliert worden und haette nichts bewirkt.
--  3. `ALTER ROLE ... NOBYPASSRLS NOREPLICATION NOCREATEDB` darf nur ein
--     Superuser (bzw. wer CREATEDB hat), auch wenn sich nichts aendert. Weil der Provisioner pro Deploy das Passwort
--     neu setzt, waere jeder zweite Deploy einer App gescheitert.
--
-- Die Loesung: Die Control Plane wird Mitglied jeder App-Rolle, aber nur mit
-- SET, ohne INHERIT. Sie erbt also keine Rechte der App; sie kann nur
-- ausdruecklich zu ihr wechseln. Das ist keine neue Macht — mit ADMIN auf der
-- Rolle (das CREATEROLE dem Anlegenden ohnehin gibt) konnte sie deren
-- Passwort schon immer setzen. Gewechselt wird nur in den zwei Funktionen
-- unten und nur fuer die Dauer der einen Anweisung.
--
-- Bestehende Migrationen bleiben unveraendert (CLAUDE.md); 0006 wird hier
-- ersetzt, nicht editiert.

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
    -- Unveraendert aus 0006: explizit, damit eine Aenderung der
    -- Server-Defaults nichts aufweicht.
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
      p_role_name, p_password
    );
  ELSE
    -- Anders als 0006: SUPERUSER, BYPASSRLS und REPLICATION darf nur ein
    -- Superuser setzen, CREATEDB nur, wer es selbst hat — jeweils auch auf
    -- den Wert, den sie schon haben. Ohne
    -- Superuser waere damit jeder zweite Deploy einer App gescheitert (der
    -- Provisioner setzt das Passwort pro Deploy neu). Also: setzen, was diese
    -- Rolle setzen darf, und den Rest **pruefen**. Haette jemand die vier von
    -- Hand gesetzt, bricht die Anlage hier ab, statt eine aufgeweichte Rolle
    -- weiterzugeben.
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = p_role_name AND (rolsuper OR rolbypassrls OR rolreplication OR rolcreatedb)
    ) THEN
      RAISE EXCEPTION 'Rolle % hat SUPERUSER, BYPASSRLS, REPLICATION oder CREATEDB — Abbruch', p_role_name;
    END IF;
    EXECUTE format(
      'ALTER ROLE %I LOGIN PASSWORD %L NOCREATEROLE NOINHERIT',
      p_role_name, p_password
    );
  END IF;

  -- Neu: Mitgliedschaft mit SET, ohne INHERIT (Postgres 16+). Vor 16 gibt es
  -- die Optionen nicht und die Pruefung aus Punkt 1 auch nicht in dieser
  -- Form; dort genuegt die einfache Mitgliedschaft.
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET TRUE', p_role_name, current_user);
  ELSE
    EXECUTE format('GRANT %I TO %I', p_role_name, current_user);
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', p_schema_name, p_role_name);

  EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', p_role_name);
  EXECUTE format('ALTER ROLE %I SET search_path = %I', p_role_name, p_schema_name);
END;
$$;

REVOKE ALL ON FUNCTION provision_app_schema(text, text, text) FROM PUBLIC;

-- Eine Leserecht-Freigabe zwischen Apps, ausgefuehrt **als** Eigentuemer des
-- Schemas. Die Funktion wechselt nur zu einer Rolle, die mit `app_` beginnt
-- und dem Schema wirklich gehoert, und nur, wenn auch das Objekt ihr gehoert.
-- `SET LOCAL` endet spaetestens mit der Transaktion, bei einem Fehler also
-- sofort; das `RESET ROLE` am Ende stellt den Aufrufer schon vorher wieder her.
CREATE OR REPLACE FUNCTION app_select_grant(
  p_schema_name text,
  p_object_name text,
  p_grantee     text,
  p_direction   text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner text;
  v_object_owner text;
BEGIN
  IF p_schema_name !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'ungueltiger Schema-Name: %', p_schema_name;
  END IF;
  IF p_grantee !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'ungueltige empfangende Rolle: %', p_grantee;
  END IF;
  IF p_object_name !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'ungueltiger Objekt-Name: %', p_object_name;
  END IF;
  IF p_direction NOT IN ('grant', 'revoke') THEN
    RAISE EXCEPTION 'ungueltige Richtung: %', p_direction;
  END IF;

  SELECT r.rolname INTO v_owner
  FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
  WHERE n.nspname = p_schema_name;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Schema % gibt es nicht', p_schema_name;
  END IF;
  IF v_owner !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Schema % gehoert keiner App-Rolle', p_schema_name;
  END IF;

  SELECT r.rolname INTO v_object_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE n.nspname = p_schema_name AND c.relname = p_object_name;
  IF v_object_owner IS NULL THEN
    RAISE EXCEPTION 'Objekt %.% gibt es nicht', p_schema_name, p_object_name;
  END IF;
  IF v_object_owner <> v_owner THEN
    RAISE EXCEPTION 'Objekt %.% gehoert nicht der Rolle des Schemas', p_schema_name, p_object_name;
  END IF;

  EXECUTE format('SET LOCAL ROLE %I', v_owner);
  IF p_direction = 'grant' THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', p_schema_name, p_grantee);
    EXECUTE format('GRANT SELECT ON %I.%I TO %I', p_schema_name, p_object_name, p_grantee);
  ELSE
    -- USAGE bleibt stehen, solange eine andere Freigabe im selben Schema
    -- offen sein kann. Ohne SELECT ist USAGE allein wertlos.
    EXECUTE format('REVOKE SELECT ON %I.%I FROM %I', p_schema_name, p_object_name, p_grantee);
  END IF;
  RESET ROLE;
END;
$$;

REVOKE ALL ON FUNCTION app_select_grant(text, text, text, text) FROM PUBLIC;
