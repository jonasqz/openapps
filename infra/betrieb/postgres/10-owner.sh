#!/bin/sh
# Laeuft genau einmal, beim ersten Start mit leerem Volume.
#
# Der Superuser des Images (POSTGRES_USER) legt nur das an, was die Control
# Plane braucht, und wird danach nicht mehr benutzt: eine Rolle mit CREATEROLE
# — fuer die App-Rollen —, aber ohne SUPERUSER, ohne BYPASSRLS, ohne CREATEDB
# (CLAUDE.md, Konventionen). Dieselben Attribute benutzen die Postgres-Tests
# (apps/control-plane/tests/pg-helpers.ts); dort steht, was ohne sie schiefging.
set -eu

: "${OPENAPPS_OWNER_PASSWORD:?OPENAPPS_OWNER_PASSWORD fehlt}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v pw="$OPENAPPS_OWNER_PASSWORD" <<'SQL'
CREATE ROLE openapps_owner LOGIN PASSWORD :'pw'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE NOREPLICATION;
CREATE DATABASE openapps OWNER openapps_owner;
SQL
