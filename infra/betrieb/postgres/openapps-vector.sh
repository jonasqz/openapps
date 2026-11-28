#!/bin/sh
# pgvector fuer die Plattform einrichten (ADR 0025). Wiederholbar: Ein
# zweiter Lauf aendert nichts.
#
# Braucht den Superuser des Images, weil `CREATE EXTENSION vector` ihn
# verlangt (vector.control traegt kein `trusted = true`). Die Rolle der
# Control Plane und die App-Rollen bleiben ohne SUPERUSER und ohne BYPASSRLS
# (CLAUDE.md); sie bekommen nur USAGE auf das Schema `extensions`.
#
# Im Container der Datenbank, als Superuser ueber den lokalen Socket:
#
#   docker exec <postgres-container> openapps-vector
#
# Ausgabe: eine Zeile mit dem Ergebnis. Keine Secrets, keine Werte aus der Env.
set -eu

db="${OPENAPPS_DATABASE:-openapps}"
owner="${OPENAPPS_OWNER_ROLE:-openapps_owner}"
superuser="${POSTGRES_USER:-postgres}"

psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc \
  --username "$superuser" --dbname "$db" \
  -v owner="$owner" \
  -f /usr/local/share/openapps/vector.sql

version="$(psql --no-psqlrc -tA --username "$superuser" --dbname "$db" \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'vector'")"
echo "openapps-vector: vector $version in schema extensions of database $db"
