-- 0019_event_cursors.sql — Cursor der Abonnements (ADR 0022 E).
--
-- Eine App ruft die Ereignisse ihrer Abonnements mit `platform.poll_events`
-- ab und quittiert sie mit `platform.ack_events`. Der Cursor liegt hier, je
-- Abonnement (abonnierende App, Quell-App, Typ), nicht in der App. Er laeuft
-- nur vorwaerts. Ohne Zeile beginnt ein Abonnement beim aeltesten Ereignis,
-- das die Aufbewahrung noch haelt.
--
-- Das Recht, Ereignisse zu sehen (`read` auf die Quell-App), steht nicht
-- hier, sondern in `grants`, und wird bei jedem Abruf geprueft.
--
-- 0001 bis 0018 bleiben unveraendert.

CREATE TABLE event_cursors (
  subscriber  text         NOT NULL REFERENCES apps (name),
  source_app  text         NOT NULL,
  type        text         NOT NULL,
  position    bigint       NOT NULL DEFAULT 0 CHECK (position >= 0),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber, source_app, type)
);
