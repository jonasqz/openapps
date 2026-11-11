#!/bin/bash
# Start im Container: Migrationen, dann Control Plane und Plattform-MCP.
#
# Zwei Prozesse in einem Container (ADR 0009): Beide brauchen dieselbe Env,
# dieselbe Datenbank und denselben Mount fuer die Traefik-Datei. Der MCP hoert
# nur auf 127.0.0.1; von aussen erreicht man ihn ueber /mcp der Control Plane.
#
# Endet einer der beiden, endet der Container — und `restart: unless-stopped`
# startet ihn neu. Ein halb laufender Stapel waere schlimmer als ein kurzer
# Neustart: Menschen kaemen herein, Agents nicht, und niemand saehe es.
set -euo pipefail

# Scheitert eine Migration, startet nichts — lieber kein Dienst als einer auf
# halbem Schema.
node_modules/.bin/tsx src/infra/pg/migrate.ts

(cd ../platform-mcp && exec node_modules/.bin/tsx src/http.ts) &
mcp=$!
node_modules/.bin/next start --port 3000 --hostname 0.0.0.0 &
next=$!

# Coolify stoppt mit SIGTERM: an beide weitergeben, dann sauber enden.
trap 'kill -TERM "$mcp" "$next" 2>/dev/null || true; wait; exit 0' TERM INT

wait -n "$mcp" "$next" || true
echo "start.sh: ein Prozess ist beendet, der Container endet" >&2
kill -TERM "$mcp" "$next" 2>/dev/null || true
wait || true
exit 1
