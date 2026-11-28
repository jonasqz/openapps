-- 0017_events.sql — Ereignisse der Apps (ADR 0022 B).
--
-- Eine App meldet ueber `platform.emit_event`, was in ihr passiert ist. Die
-- Control Plane nimmt es nur an, wenn Signatur und Freigabe stimmen und der
-- Typ im Manifest der laufenden Version steht (src/domain/events.ts). Diese
-- Tabelle ist selbst das Protokoll der angenommenen Ereignisse; ins Audit-Log
-- kommen nur Ablehnungen.
--
-- Kein Inhalt ausser dem Titel: Der Inhalt bleibt in der App, Home verlinkt
-- dorthin. `audience` ist die Angabe der App, wie sie kam; wer davon eine
-- Benachrichtigung bekam, steht in `notifications` (0018).
--
-- Hart geloescht nach `OPENAPPS_EVENTS_RETENTION_DAYS` (Default 90), gemessen
-- an `received_at`, der Uhr der Plattform (ADR 0022 F).
--
-- 0001 bis 0016 bleiben unveraendert.

CREATE TABLE events (
  -- Fortlaufend: der Cursor der Abonnements (0019).
  seq          bigserial    PRIMARY KEY,
  app_name     text         NOT NULL REFERENCES apps (name),
  -- Von der App vergeben; dieselbe Id zweimal ist ein Doppel, kein Fehler.
  event_id     text         NOT NULL
               CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  type         text         NOT NULL
               CHECK (length(type) <= 64 AND type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  object       text         NOT NULL CHECK (length(object) BETWEEN 1 AND 300),
  title        text         NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  -- Pfad in der App ohne basePath. Die volle Adresse setzt die Plattform davor.
  path         text         NOT NULL CHECK (left(path, 1) = '/' AND length(path) <= 1000),
  actor        text         CHECK (actor IS NULL OR length(actor) <= 320),
  audience     text[]       NOT NULL DEFAULT '{}' CHECK (cardinality(audience) <= 50),
  -- Aus dem Manifest beim Annehmen, nicht von der App je Ereignis.
  importance   text         NOT NULL CHECK (importance IN ('high', 'normal', 'low')),
  occurred_at  timestamptz  NOT NULL,
  received_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (app_name, event_id)
);

-- Der Lesepfad der Abonnements: je Quell-App und Typ ab dem Cursor.
CREATE INDEX events_subscription_idx ON events (app_name, type, seq);
-- Der Loeschlauf der Aufbewahrung.
CREATE INDEX events_received_at_idx ON events (received_at);
