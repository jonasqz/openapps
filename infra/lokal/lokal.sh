#!/usr/bin/env bash
# docker compose fuer den lokalen Stapel, mit einem Dienst je App
# (docker-compose.apps.yml, erzeugt von apps-dienste.mjs). Alle Argumente gehen
# an docker compose, etwa:
#
#   ./infra/lokal/lokal.sh up -d --build
#   ./infra/lokal/lokal.sh logs -f app-crm
#   ./infra/lokal/lokal.sh down -v
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/apps-dienste.mjs" >&2
exec docker compose \
  -f "$here/docker-compose.yml" \
  -f "$here/docker-compose.apps.yml" \
  --env-file "$here/.env" \
  --profile ansehen \
  "$@"
