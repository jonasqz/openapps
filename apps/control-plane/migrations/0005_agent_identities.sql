-- 0005_agent_identities.sql — Ein OAuth-Client pro Agent.
-- Der Agent ist ein Subjekt wie ein Mensch: Freigaben an ihn stehen in grants,
-- seine Aufrufe stehen im audit_log. Hier steht nur, wie er sich anmeldet.
--
-- Es wird nie ein Secret gespeichert, nur sein Hash. Das Klartext-Secret
-- existiert einmal in der Antwort des Anlege-Aufrufs.

CREATE TABLE agent_identities (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Subjekt-Id in grants und audit_log: 'agent:<name>'.
  name               text         NOT NULL UNIQUE
                     CHECK (name ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name       text         NOT NULL,
  oauth_client_id    text         NOT NULL UNIQUE,
  oauth_client_secret_hash text    NOT NULL,
  -- Wem der Agent gehoert (Nutzer-Id); fuer die Zurechenbarkeit.
  owner_user_id      text         NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  last_seen_at       timestamptz,
  disabled_at        timestamptz
);

CREATE INDEX agent_identities_client_idx
  ON agent_identities (oauth_client_id) WHERE disabled_at IS NULL;
