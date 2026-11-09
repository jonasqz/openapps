-- 0009_groups.sql — Gruppen und Mitgliedschaften.
--
-- Entscheidung (CoS, 2026-11-09): Gruppen leben in der Control Plane, nicht im
-- Token. Der fruehere Kommentar in `src/lib/session.ts` behauptete, sie kaemen
-- aus dem Google-SSO-Claim; Google liefert ohne Workspace-Admin-SDK keine
-- Gruppen. Damit gilt CLAUDE.md Grundsatz 4 ohne Ausnahme: wer wo dazugehoert,
-- steht hier, direkt neben `grants`, das in 0003 schon `subject_kind = 'group'`
-- kennt.
--
-- Diese zwei Tabellen liegen deshalb absichtlich im selben Schema wie `grants`
-- und nicht bei den Better-Auth-Tabellen (0008): sie sind Rechtemodell, nicht
-- Login-Zustand. Jede `can()`-Pruefung liest beide in derselben Verbindung.

CREATE TABLE groups (
  -- Gleiche Form wie ein App-Name: taugt als Wert in grants.subject_id und
  -- als Teil des X-Auth-Groups-Headers (kommagetrennt, also kein Komma).
  name        text        PRIMARY KEY
              CHECK (name ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Mitgliedschaft ueber die **E-Mail**, nicht ueber control_plane."user".id.
--
-- Begruendung: Die Nutzer-Zeile entsteht erst beim ersten Login. Eine
-- Mitgliedschaft muss vorher vergeben werden koennen — sonst braeuchte jede
-- Freigabe einen Nutzer, der sich zuerst anmeldet, obwohl ihn ohne Freigabe
-- nichts hereinlaesst. Genau dieses Henne-Ei-Problem loest auch
-- AUTH_BOOTSTRAP_ADMINS, und das ist eine E-Mail-Liste. Ein Fremdschluessel auf
-- die Nutzer-Tabelle wuerde das verbieten.
--
-- Was das kostet: Wird eine E-Mail-Adresse im IdP an eine andere Person
-- vergeben, erbt diese die Mitgliedschaften. Die Schranke dagegen ist
-- AUTH_ALLOWED_EMAIL_DOMAINS plus die Pflege im Workspace; eine Mitgliedschaft
-- ist widerrufbar wie jede Freigabe.
CREATE TABLE group_members (
  group_name text        NOT NULL REFERENCES groups (name) ON DELETE CASCADE,
  -- Immer kleingeschrieben gespeichert, damit der Vergleich eindeutig ist.
  email      text        NOT NULL
             CHECK (email = lower(email) AND email ~ '^[^@[:space:],]+@[^@[:space:],]+$'),
  added_by   text        NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_name, email)
);

-- Der Lesepfad: Welche Gruppen hat diese E-Mail? Laeuft bei jedem
-- Forward-Auth-Aufruf, ohne Cache (Widerruf wirkt sofort).
CREATE INDEX group_members_email_idx ON group_members (email);

-- Die Gruppe, die in 0006 den Wildcard-Grant bekommen hat. Sie existiert hier
-- als Zeile, bleibt aber leer: Mitglieder kommen ueber AUTH_BOOTSTRAP_ADMINS
-- beim ersten Login oder spaeter ueber die Control Plane. Ohne diese Env-Liste
-- kommt niemand herein — das ist der gewollte Ausgangszustand.
INSERT INTO groups (name, description)
VALUES ('platform-admins', 'Plattform-Administration. Wildcard-Grant aus Migration 0006.');
