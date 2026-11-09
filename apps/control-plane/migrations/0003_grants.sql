-- 0003_grants.sql — Das eine Rechtemodell.
-- Wer (Subjekt) darf was (Verb) auf welcher Ressource. Nichts anderes vergibt
-- Rechte: keine Rolle-Spalte an Nutzern, keine Flags an Apps.
--
-- Default-Deny ist die Abwesenheit einer Zeile. Widerruf setzt revoked_at und
-- loescht nicht, damit das Audit nachvollziehbar bleibt.

CREATE TYPE grant_subject_kind  AS ENUM ('user', 'group', 'app', 'agent');
CREATE TYPE grant_verb          AS ENUM ('read', 'write', 'execute');
CREATE TYPE grant_resource_kind AS ENUM ('app', 'table', 'view', 'tool');

CREATE TABLE grants (
  id             uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind   grant_subject_kind   NOT NULL,
  subject_id     text                 NOT NULL,
  verb           grant_verb           NOT NULL,
  resource_kind  grant_resource_kind  NOT NULL,
  -- '*' ist die Wildcard fuer alle Ressourcen dieser Art. Sie wird sparsam
  -- vergeben (Plattform-Administration, siehe 0006).
  resource_id    text                 NOT NULL,
  granted_by     text                 NOT NULL,
  granted_at     timestamptz          NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     text,
  CHECK (revoked_at IS NULL OR revoked_by IS NOT NULL)
);

-- Dieselbe Freigabe darf nur einmal offen sein; widerrufene bleiben liegen.
CREATE UNIQUE INDEX grants_unique_active_idx
  ON grants (subject_kind, subject_id, verb, resource_kind, resource_id)
  WHERE revoked_at IS NULL;

-- Der Index, auf dem jede can()-Pruefung laeuft. Es gibt keinen Cache ueber
-- Freigaben (DoD 3: Widerruf wirkt sofort), also muss der Lesepfad schnell sein.
CREATE INDEX grants_lookup_idx
  ON grants (resource_kind, resource_id, verb, subject_kind, subject_id)
  WHERE revoked_at IS NULL;
