-- pgvector fuer Apps, die es im Manifest erklaeren (`databaseExtensions`,
-- ADR 0025). Laeuft als Superuser in der Datenbank der Plattform, ueber
-- openapps-vector (frisches Volume: 20-vector.sh). Wiederholbar: Jede
-- Anweisung ist ohne Wirkung, wenn ihr Ziel schon erreicht ist.
--
-- Was danach gilt:
--
-- - Schema `extensions`, Eigentuemer ist der Superuser. PUBLIC hat darauf
--   nichts, also auch keine App-Rolle ohne ausdrueckliche Freigabe.
-- - `vector` liegt in diesem Schema. Apps sprechen Typ und Operatoren voll
--   qualifiziert an (`extensions.vector`, `OPERATOR(extensions.<=>)`); der
--   search_path des SDK bleibt, wie er ist.
-- - Die Rolle der Control Plane (psql-Variable owner) hat USAGE mit Weitergaberecht.
--   Sie gibt einer App-Rolle USAGE, wenn deren Manifest `vector` nennt
--   (Migration 0025 der Control Plane), nie CREATE.
\set ON_ERROR_STOP on
\if :{?owner}
\else
\set owner openapps_owner
\endif

-- Alles oder nichts: Scheitert ein Schritt, bleibt die Datenbank, wie sie war.
BEGIN;

-- Liegt `vector` schon in einem anderen Schema, wird nichts verschoben:
-- Andere Objekte koennen davon abhaengen. Lieber abbrechen als still umbauen.
DO $$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'vector';
  IF v_schema IS NOT NULL AND v_schema <> 'extensions' THEN
    RAISE EXCEPTION 'vector is installed in schema %, not in extensions; check who uses it and move it by hand', v_schema;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS extensions;

-- Gehoert das Schema keinem Superuser, koennte sein Eigentuemer darin Objekte
-- anlegen, die jede App mit USAGE sieht. Abbrechen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
     WHERE n.nspname = 'extensions' AND r.rolsuper
  ) THEN
    RAISE EXCEPTION 'schema extensions is not owned by a superuser; refusing to use it';
  END IF;
END
$$;

REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO :"owner" WITH GRANT OPTION;

COMMIT;
