#!/usr/bin/env bash
# Registriert und deployt die Standard-Apps und legt den Agenten `betrieb` an.
# Laeuft gegen den Stapel aus docker-compose.yml (muss schon laufen).
#
# Das Token von `betrieb` landet nur in .agents/betrieb.token (Modus 0600,
# gitignoriert) und in .agents/mcp-betrieb.json fuer `claude --mcp-config`.
# Es wird nie angezeigt.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/docker-compose.yml" --env-file "$here/.env")

umask 077
mkdir -p "$here/.agents"
out="$("${compose[@]}" exec -T control-plane node_modules/.bin/tsx src/infra/lokal-einrichten.ts)"
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
