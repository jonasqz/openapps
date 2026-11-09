-- 0007_app_auth_secret.sql — das Gateway-Secret pro App (ADR 0004).
--
-- Jede App braucht ein eigenes `OPENAPPS_AUTH_SECRET`. Hier steht **kein**
-- Secret: es wird bei Bedarf aus einem Master-Secret der Control Plane und
-- dieser Generation abgeleitet (HKDF, siehe src/domain/app-secret.ts). Damit
-- liegt kein App-Secret in der Datenbank, und eine Rotation fuer eine einzelne
-- App ist das Hochzaehlen einer Zahl plus ein Redeploy.

ALTER TABLE apps
  ADD COLUMN auth_secret_generation integer NOT NULL DEFAULT 1
    CHECK (auth_secret_generation >= 1);

COMMENT ON COLUMN apps.auth_secret_generation IS
  'Generation des abgeleiteten OPENAPPS_AUTH_SECRET. Hochzaehlen = Rotation, wirkt beim naechsten Deploy.';
