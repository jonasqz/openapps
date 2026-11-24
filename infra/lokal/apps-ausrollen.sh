#!/usr/bin/env bash
# Baut, registriert und deployt die Apps aus standard-apps/ und legt beim
# ersten Mal den Agenten `betrieb` an (ADR 0011, ADR 0015).
#
#   ./infra/lokal/apps-ausrollen.sh            # alles bauen und starten
#   ./infra/lokal/apps-ausrollen.sh urlaub     # nur diese App neu bauen
#
# Eine neue App ist ein Ordner standard-apps/<name> mit app.json, etwa aus
# create_app im Plattform-MCP. Ein geaenderter Stand braucht eine hoehere
# "version" in app.json, wie auf dem Server.
#
# Das Token von `betrieb` landet nur in .agents/betrieb.token (Modus 0600,
# gitignoriert) und in .agents/mcp-betrieb.json fuer `claude --mcp-config`.
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
  services=(control-plane)
  while read -r svc; do services+=("$svc"); done < <("$lokal" config --services 2>/dev/null | grep '^app-')
fi
for svc in "${services[@]}"; do
  echo "Baue $svc"
  "$lokal" build --quiet "$svc"
done
"$lokal" up -d --remove-orphans >/dev/null

umask 077
mkdir -p "$here/.agents"
out="$("$lokal" exec -T control-plane node_modules/.bin/tsx src/infra/lokal-einrichten.ts)"
# Alles ausser der Token-Zeile anzeigen.
grep -v '^BETRIEB_TOKEN=' <<<"$out" || true

token="$(sed -n 's/^BETRIEB_TOKEN=//p' <<<"$out")"
if [[ -n "$token" ]]; then
  printf '%s' "$token" > "$here/.agents/betrieb.token"
  echo "Token von betrieb: $here/.agents/betrieb.token"
fi

if [[ -f "$here/.agents/betrieb.token" ]]; then
  node -e '
    const fs = require("fs");
    const [token, file] = [fs.readFileSync(process.argv[1], "utf8").trim(), process.argv[2]];
    const cfg = { mcpServers: { openapps: { type: "http", url: "http://localhost:8080/mcp",
      headers: { Authorization: `Bearer ${token}` } } } };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  ' "$here/.agents/betrieb.token" "$here/.agents/mcp-betrieb.json"
  echo "MCP-Konfiguration: $here/.agents/mcp-betrieb.json"
fi
echo "Apps: http://127.0.0.1:8090 · Verwaltung: http://127.0.0.1:8091"
