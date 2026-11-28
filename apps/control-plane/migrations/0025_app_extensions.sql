-- 0025_app_extensions.sql — Postgres-Erweiterungen fuer App-Rollen (ADR 0025).
--
-- Eine App nennt im Manifest `databaseExtensions` (heute nur `vector`). Die
-- Erweiterung selbst legt der Betreiber einmal als Superuser im Schema
-- `extensions` an (`openapps-vector` im Postgres-Image); die Control Plane
-- kann das nicht und soll es nicht koennen: `CREATE EXTENSION vector`
-- verlangt den Superuser, und `openapps_owner` bleibt ohne SUPERUSER und
-- ohne BYPASSRLS (CLAUDE.md).
--
-- Diese Funktion ist die eine Stelle, an der die Control Plane einer
-- App-Rolle Zugang zu `extensions` gibt oder nimmt, bei jedem Deploy:
--
--  - Mit Bedarf: Pruefen, dass jede genannte Erweiterung im Schema
--    `extensions` liegt (sonst Abbruch mit dem Hinweis auf den einmaligen
--    Schritt), dann `USAGE` auf das Schema. Nie `CREATE`: Eine App nutzt
--    Typen und Operatoren, sie legt dort nichts an.
--  - Ohne Bedarf: `USAGE` entziehen, das die Control Plane erteilt hat.
--  - In beiden Faellen: Hat die Rolle danach `CREATE` auf `extensions` oder
--    ohne Bedarf noch `USAGE` (von Hand erteilt), bricht die Funktion ab,
--    statt eine aufgeweichte Rolle weiterzugeben. Wie 0013: setzen, was die
--    Control Plane setzen darf, und den Rest pruefen. Ein GRANT ohne
--    Weitergaberecht waere nur eine WARNING; deshalb wird das Ergebnis mit
--    `has_schema_privilege` nachgeprueft.
--
-- Laeuft mit den Rechten des Aufrufers (kein SECURITY DEFINER). 0001 bis 0024
-- bleiben unveraendert.

CREATE OR REPLACE FUNCTION app_database_extensions(
  p_role_name  text,
  p_extensions text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_extension text;
  v_needed boolean := cardinality(coalesce(p_extensions, '{}'::text[])) > 0;
BEGIN
  IF p_role_name !~ '^app_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'ungueltiger Rollen-Name: %', p_role_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role_name) THEN
    RAISE EXCEPTION 'Rolle % gibt es nicht', p_role_name;
  END IF;

  FOREACH v_extension IN ARRAY coalesce(p_extensions, '{}'::text[]) LOOP
    -- Dieselbe Liste wie `databaseExtensionSchema` im Manifest.
    IF v_extension NOT IN ('vector') THEN
      RAISE EXCEPTION 'unbekannte Erweiterung: %', v_extension;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = v_extension AND n.nspname = 'extensions'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'undefined_object',
        MESSAGE = format('database extension %s is not installed in schema extensions', v_extension),
        HINT = 'Run openapps-vector once as superuser in the database container (infra/betrieb/README.md).';
    END IF;
  END LOOP;

  -- Ohne Schema gibt es nichts zu erteilen (dann haette die Schleife schon
  -- abgebrochen) und nichts zu entziehen.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    RETURN;
  END IF;

  IF v_needed THEN
    EXECUTE format('GRANT USAGE ON SCHEMA extensions TO %I', p_role_name);
    IF NOT has_schema_privilege(p_role_name, 'extensions', 'USAGE') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = format('USAGE on schema extensions could not be granted to %s', p_role_name),
        HINT = 'The control plane role needs USAGE WITH GRANT OPTION on schema extensions; run openapps-vector once as superuser.';
    END IF;
  ELSE
    EXECUTE format('REVOKE USAGE ON SCHEMA extensions FROM %I', p_role_name);
    IF has_schema_privilege(p_role_name, 'extensions', 'USAGE') THEN
      RAISE EXCEPTION 'Rolle % hat USAGE auf extensions ohne Bedarf im Manifest (von Hand erteilt?) — Abbruch', p_role_name;
    END IF;
  END IF;

  IF has_schema_privilege(p_role_name, 'extensions', 'CREATE') THEN
    RAISE EXCEPTION 'Rolle % hat CREATE auf extensions — Abbruch', p_role_name;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_database_extensions(text, text[]) FROM PUBLIC;
