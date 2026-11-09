-- 0002_deployments.sql — Deployments und ihr Review-Ergebnis.
-- Jeder Deploy-Versuch ist eine Zeile, auch der blockierte. Das Review-Ergebnis
-- bleibt dauerhaft an der Zeile haengen; es ist der Nachweis fuer DoD 4.

CREATE TYPE deployment_status AS ENUM (
  'pending',    -- angelegt, Review laeuft noch nicht
  'reviewing',  -- Review-Gate laeuft
  'blocked',    -- Review-Gate hat blockiert, kein Deploy
  'deploying',  -- an das Deploy-Backend uebergeben
  'live',       -- laeuft
  'superseded', -- durch eine neuere Version ersetzt
  'failed',     -- Deploy-Backend hat gemeldet, dass es nicht lief
  'rolled_back' -- durch Rollback abgeloest
);

CREATE TABLE deployments (
  id             uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         uuid               NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  version        text               NOT NULL,
  git_sha        text               NOT NULL CHECK (git_sha ~ '^[0-9a-f]{7,40}$'),
  status         deployment_status  NOT NULL DEFAULT 'pending',
  -- Gesamtentscheidung des Gates: 'pass' | 'blocked' | NULL (noch nicht gelaufen)
  review_decision  text             CHECK (review_decision IN ('pass', 'blocked')),
  -- Vollstaendiges Ergebnis der Pipeline: Schritte, Befunde, Claude-Report.
  review_result    jsonb,
  -- Referenz des Deploy-Backends (opak; kein Begriff eines Anbieters in Code
  -- oder Spalte, nur hier als Zeichenkette).
  backend_ref      text,
  requested_by     text             NOT NULL,
  requested_at     timestamptz      NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  deployed_at      timestamptz,
  UNIQUE (app_id, version)
);

CREATE INDEX deployments_app_requested_idx ON deployments (app_id, requested_at DESC);

ALTER TABLE apps
  ADD CONSTRAINT apps_current_deployment_fkey
  FOREIGN KEY (current_deployment_id) REFERENCES deployments (id) ON DELETE SET NULL;

ALTER TABLE apps
  ADD CONSTRAINT apps_previous_deployment_fkey
  FOREIGN KEY (previous_deployment_id) REFERENCES deployments (id) ON DELETE SET NULL;
