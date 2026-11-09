-- 0001_apps.sql — Register der Apps.
-- Eine App ist ein Paket mit Manifest, Quelle, eigenem Schema und eigener
-- DB-Rolle. Die Zeiger auf aktuelles und vorheriges Deployment machen den
-- Rollback (DoD 5) zu einem Zeiger-Tausch.
--
-- Bestehende Migrationen werden nie geaendert. Korrekturen kommen als neue
-- Migration mit hoeherer Nummer.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE apps (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kleinbuchstaben, Ziffern, Bindestrich: taugt als Schema-, Rollen- und
  -- Subdomain-Name.
  name                    text         NOT NULL UNIQUE
                          CHECK (name ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  display_name            text         NOT NULL,
  category                text,
  -- Das app.json, wie es beim letzten erfolgreichen Deploy gueltig war.
  manifest                jsonb        NOT NULL,
  -- Katalog-Quelle: { "kind": "git" | "local" | "catalog", ... }
  source                  jsonb        NOT NULL,
  -- Von der Control Plane angelegt, nicht von der App gewaehlt.
  schema_name             text         NOT NULL UNIQUE
                          CHECK (schema_name ~ '^app_[a-z0-9_]+$'),
  db_role                 text         NOT NULL UNIQUE
                          CHECK (db_role ~ '^app_[a-z0-9_]+$'),
  primary_domain          text         UNIQUE,
  -- Deployment-Zeiger. FK kommt in 0002, weil deployments erst dort entsteht.
  current_deployment_id   uuid,
  previous_deployment_id  uuid,
  archived_at             timestamptz,
  created_by              text         NOT NULL,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX apps_active_idx ON apps (name) WHERE archived_at IS NULL;
