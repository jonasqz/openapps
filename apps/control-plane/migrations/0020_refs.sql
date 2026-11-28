-- 0020_refs.sql — Verweise zwischen Apps, zentral in beide Richtungen (ADR 0023 C).
--
-- Eine App meldet ueber `platform.set_refs` die **vollstaendige** Menge der
-- ausgehenden Verweise eines eigenen Objekts. Die Quell-App kommt aus der
-- geprueften Identitaet, nie aus der Meldung (src/domain/refs.ts). Eine leere
-- Menge loescht die Verweise, ein aelterer Stand als der gespeicherte wird
-- ignoriert.
--
-- Zwei Tabellen in einer Migration: `ref_sources` haelt den Stand je Quelle
-- auch dann, wenn ihre Menge leer ist. Ohne ihn koennte eine verspaetete
-- aeltere Meldung nach einem Loeschen die alten Verweise zurueckbringen.
-- `refs` haelt je Quelle und Ziel eine Zeile, fuer die Rueckverweise.
--
-- Keine Titel, kein Inhalt: Was ein Objekt heisst, fragt die Plattform beim
-- Aufloesen die Ziel-App, mit der Rechtepruefung des Betrachters. Wer welche
-- Zeile sehen darf (beide Apps lesbar), entscheidet die Domaene, nicht diese
-- Tabelle.
--
-- 0001 bis 0019 bleiben unveraendert.

CREATE TABLE ref_sources (
  -- `<app>:<typ>:<id>` (packages/app-manifest/src/refs.ts).
  source       text         PRIMARY KEY CHECK (length(source) BETWEEN 5 AND 400),
  app_name     text         NOT NULL REFERENCES apps (name),
  -- Stand des Objekts laut App; Meldungen mit aelterem Stand werden ignoriert.
  updated_at   timestamptz  NOT NULL,
  received_at  timestamptz  NOT NULL DEFAULT now(),
  -- Die Quelle gehoert der App, die sie meldet.
  CHECK (split_part(source, ':', 1) = app_name)
);

CREATE TABLE refs (
  source       text         NOT NULL REFERENCES ref_sources (source) ON DELETE CASCADE,
  -- Objekt (`<app>:<typ>:<id>`) oder Subjekt (`human:<email>`, `group:<name>`,
  -- `agent:<name>`).
  target       text         NOT NULL CHECK (length(target) BETWEEN 3 AND 400),
  -- App des Ziels bei Objekten, sonst NULL. Nicht auf `apps` verwiesen: Ein
  -- Verweis auf eine App, die es (noch) nicht gibt, ist gueltig und loest
  -- sich als `restricted` auf.
  target_app   text,
  kind         text         NOT NULL CHECK (kind IN ('mention', 'link', 'derived')),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (source, target),
  -- Erwaehnungen nennen Subjekte, Links und Ableitungen Objekte.
  CHECK ((kind = 'mention') = (target_app IS NULL))
);

-- Der Lesepfad der Rueckverweise: alle Quellen eines Ziels.
CREATE INDEX refs_target_idx ON refs (target);
