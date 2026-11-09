-- 0004_audit_log.sql — Wer, was, worauf, mit welchem Ergebnis, wann.
-- Jeder Agent-Aufruf landet hier, auch der abgelehnte (DoD 6). Die Tabelle ist
-- append-only; es gibt absichtlich kein UPDATE und kein DELETE im Code.

CREATE TYPE audit_outcome AS ENUM ('allowed', 'denied', 'error');

CREATE TABLE audit_log (
  id             bigserial       PRIMARY KEY,
  occurred_at    timestamptz     NOT NULL DEFAULT now(),
  -- Subjekt in derselben Sprache wie grants.
  actor_kind     grant_subject_kind NOT NULL,
  actor_id       text            NOT NULL,
  -- Name der Aktion, gleich benannt wie das MCP-Tool: 'create_app', 'grant', ...
  action         text            NOT NULL,
  resource_kind  grant_resource_kind,
  resource_id    text,
  outcome        audit_outcome   NOT NULL,
  -- Grund bei 'denied' / 'error', sonst NULL.
  reason         text,
  -- Nicht-geheime Nutzlast: Argumente ohne Secrets, Ergebnis-Ids.
  detail         jsonb           NOT NULL DEFAULT '{}'::jsonb,
  -- Aufrufkette: MCP-Session, HTTP-Request, Deployment.
  correlation_id text
);

CREATE INDEX audit_log_actor_idx    ON audit_log (actor_kind, actor_id, occurred_at DESC);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_kind, resource_id, occurred_at DESC);
CREATE INDEX audit_log_action_idx   ON audit_log (action, occurred_at DESC);
