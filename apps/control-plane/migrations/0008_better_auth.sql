-- 0008_better_auth.sql — Die Tabellen von Better Auth (Google-SSO).
--
-- Herkunft des DDL: nicht erfunden, sondern von Better Auth 1.2.7 selbst
-- ausgegeben. `@better-auth/cli generate` laeuft in diesem Workspace nicht
-- (das CLI-Paket ist keine Abhaengigkeit), also wurde derselbe Code direkt
-- aufgerufen: `getMigrations(options).compileMigrations()` aus `better-auth/db`
-- — genau die Funktion, die hinter dem CLI steht. Spalten, Typen und
-- Fremdschluessel stehen unten unveraendert so, wie sie erzeugt wurden.
--
-- Abweichung, bewusst und einzig: Die Tabellen liegen im Schema
-- `control_plane`, nicht in `public`. Better Auth kennt kein Schema-Feld;
-- die Zuordnung passiert ueber Kysely (`WithSchemaPlugin`) in
-- `src/lib/auth.ts`. Wer das Schema hier aendert, aendert es dort mit.
--
-- Warum ein eigenes Schema: In `public` haengen die Tabellen des
-- Rechtemodells, und `provision_app_schema` (0006) entzieht einer App-Rolle
-- `public` ausdruecklich. Ein neues Schema hat per Default keine Rechte fuer
-- PUBLIC — Sessions und OAuth-Token einer Person sind damit fuer keine
-- App-Rolle sichtbar, ohne dass eine weitere REVOKE-Zeile das leisten muss.

CREATE SCHEMA IF NOT EXISTS control_plane;

-- Kein Recht fuer PUBLIC, ausdruecklich. Nur die Owner-Rolle der Control Plane
-- arbeitet hier.
REVOKE ALL ON SCHEMA control_plane FROM PUBLIC;

-- `control_plane` zuerst, `public` dahinter: die Tabellen unten entstehen im
-- neuen Schema, und der Migrations-Laeufer findet `schema_migrations` in
-- derselben Transaktion weiter. SET LOCAL gilt nur fuer diese Transaktion.
SET LOCAL search_path TO control_plane, public;

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamp not null, "updatedAt" timestamp not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamp not null, "token" text not null unique, "createdAt" timestamp not null, "updatedAt" timestamp not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id"));

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id"), "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamp, "refreshTokenExpiresAt" timestamp, "scope" text, "password" text, "createdAt" timestamp not null, "updatedAt" timestamp not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamp not null, "createdAt" timestamp, "updatedAt" timestamp);

-- Zusaetzlich, nicht aus dem Generator: die Indizes auf den Lesepfaden. Jede
-- Forward-Auth-Entscheidung liest eine Session (ueber den Unique-Index auf
-- `token`), und beim Login wird das Konto ueber Anbieter plus Anbieter-Id
-- gesucht. Ohne diese Indizes laeuft das als Seq Scan pro Request.
CREATE INDEX session_user_id_idx ON control_plane."session" ("userId");
CREATE INDEX session_expires_at_idx ON control_plane."session" ("expiresAt");
CREATE INDEX account_user_id_idx ON control_plane."account" ("userId");
CREATE INDEX account_provider_idx ON control_plane."account" ("providerId", "accountId");
CREATE INDEX verification_identifier_idx ON control_plane."verification" ("identifier");
