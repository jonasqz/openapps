#!/bin/bash
# Start im Container: Migrationen, dann Control Plane, Plattform-MCP und der
# Prozess fuer Laeufe der Plattform-Agents.
#
# Drei Prozesse in einem Container (ADR 0009, ADR 0024 E): Alle brauchen
# dieselbe Env, dieselbe Datenbank; Next und MCP denselben Mount fuer die
# Traefik-Datei. Der MCP hoert nur auf 127.0.0.1; von aussen erreicht man ihn
# ueber /mcp der Control Plane. Der Prozess fuer Laeufe hoert auf nichts, er
# nimmt Laeufe aus der Warteschlange in Postgres. Ohne Chat-Modell wartet er.
#
# Endet einer der drei, endet der Container — und `restart: unless-stopped`
# startet ihn neu. Ein halb laufender Stapel waere schlimmer als ein kurzer
# Neustart: Menschen kaemen herein, Agents nicht, und niemand saehe es.
set -euo pipefail

# Scheitert eine Migration, startet nichts — lieber kein Dienst als einer auf
# halbem Schema.
node_modules/.bin/tsx src/infra/pg/migrate.ts

(cd ../platform-mcp && exec node_modules/.bin/tsx src/http.ts) &
mcp=$!
(cd ../platform-mcp && exec node_modules/.bin/tsx src/runner.ts) &
runner=$!
node_modules/.bin/next start --port 3000 --hostname 0.0.0.0 &
next=$!

# Coolify stoppt mit SIGTERM: an alle weitergeben, dann sauber enden.
trap 'kill -TERM "$mcp" "$runner" "$next" 2>/dev/null || true; wait; exit 0' TERM INT

wait -n "$mcp" "$runner" "$next" || true
echo "start.sh: ein Prozess ist beendet, der Container endet" >&2
kill -TERM "$mcp" "$runner" "$next" 2>/dev/null || true
wait || true
exit 1
