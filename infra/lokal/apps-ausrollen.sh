#!/usr/bin/env bash
# Baut, registriert und deployt die Apps aus standard-apps/ und legt beim
# ersten Mal den Agenten `operator` an (ADR 0011, ADR 0015).
#
#   ./infra/lokal/apps-ausrollen.sh            # alles bauen und starten
#   ./infra/lokal/apps-ausrollen.sh urlaub     # nur diese App neu bauen
#
# Eine neue App ist ein Ordner standard-apps/<name> mit app.json, etwa aus
# create_app im Plattform-MCP. Ein geaenderter Stand braucht eine hoehere
# "version" in app.json, wie auf dem Server.
#
# Das Token von `operator` landet nur in .agents/operator.token (Modus 0600,
# gitignoriert) und in .agents/mcp-operator.json fuer `claude --mcp-config`.
# Es wird nie angezeigt.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
lokal="$here/lokal.sh"

# Eine neue App ist ein neues Workspace-Paket: Der Lockfile muss sie kennen,
# sonst scheitert der Build im Container (--frozen-lockfile).
(cd "$repo" && pnpm install --prefer-offline --reporter=silent)

# Images nacheinander bauen, nicht parallel: Jeder Build installiert den
# ganzen Workspace, und mehrere zugleich sprengen den Speicher von Docker
# Desktop (beim ersten Lauf auf einem frischen Rechner gesehen).
services=()
for app in "$@"; do services+=("app-$app"); done
if [[ ${#services[@]} -eq 0 ]]; then
  # postgres zuerst: Das Image bringt pgvector mit (ADR 0025). Ein neues
  # Image ersetzt nur den Container, das Volume mit den Daten bleibt.
  services=(postgres control-plane)
  while read -r svc; do services+=("$svc"); done < <("$lokal" config --services 2>/dev/null | grep '^app-')
fi
for svc in "${services[@]}"; do
  echo "Building $svc"
  "$lokal" build --quiet "$svc"
done
"$lokal" up -d --remove-orphans >/dev/null

# pgvector im Schema `extensions` (ADR 0025), als Superuser im Container der
# Datenbank. Init-Skripte laufen nur bei leerem Volume; dieser Schritt deckt
# das bestehende Volume ab und aendert beim zweiten Lauf nichts. Er muss vor
# dem Deploy stehen: Eine App mit `databaseExtensions` startet sonst nicht.
if ! "$lokal" exec -T postgres openapps-vector; then
  echo "Database extensions: openapps-vector failed. Rebuild the database image with" >&2
  echo "  ./infra/lokal/apps-ausrollen.sh   (without arguments)" >&2
  exit 1
fi

umask 077
mkdir -p "$here/.agents"
out="$("$lokal" exec -T control-plane node_modules/.bin/tsx src/infra/lokal-einrichten.ts)"
# Alles ausser der Token-Zeile anzeigen.
grep -v '^OPERATOR_TOKEN=' <<<"$out" || true

token="$(sed -n 's/^OPERATOR_TOKEN=//p' <<<"$out")"
if [[ -n "$token" ]]; then
  printf '%s' "$token" > "$here/.agents/operator.token"
  echo "Token of operator: $here/.agents/operator.token"
fi

if [[ -f "$here/.agents/operator.token" ]]; then
  node -e '
    const fs = require("fs");
    const [token, file] = [fs.readFileSync(process.argv[1], "utf8").trim(), process.argv[2]];
    const cfg = { mcpServers: { openapps: { type: "http", url: "http://localhost:8080/mcp",
      headers: { Authorization: `Bearer ${token}` } } } };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  ' "$here/.agents/operator.token" "$here/.agents/mcp-operator.json"
  echo "MCP configuration: $here/.agents/mcp-operator.json"
fi
echo "Apps: http://127.0.0.1:8090 · Admin: http://127.0.0.1:8091"
