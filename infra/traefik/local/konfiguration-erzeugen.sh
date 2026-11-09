#!/usr/bin/env bash
# Erzeugt local/dynamic/openapps.yaml mit dem echten Generator der Control
# Plane (siehe erzeuge-konfiguration.mts).
#
# Warum der Umweg ueber esbuild: Der Generator haengt ueber
# `domain/gateway-headers.ts` an `@openapps/sdk` — eine Zeile, die so sein
# muss, weil Header-Namen und Signatur-Material nur eine Quelle haben duerfen
# (ADR 0004). Das SDK zieht `pg` nach, und `pg` ist CJS ohne benannte
# ESM-Exporte; ein direkter `tsx`-Lauf scheitert daran. Gebuendelt laeuft es.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
esbuild="$repo/node_modules/.pnpm/esbuild@0.23.1/node_modules/esbuild/bin/esbuild"

if [[ ! -x "$esbuild" ]]; then
  echo "esbuild nicht gefunden ($esbuild) — 'pnpm install' im Repo-Wurzelverzeichnis?" >&2
  exit 1
fi

bundle="$(mktemp -t openapps-gateway-config).cjs"
trap 'rm -f "$bundle"' EXIT
"$esbuild" "$here/erzeuge-konfiguration.mts" \
  --bundle --platform=node --format=cjs --log-level=warning --outfile="$bundle"
node "$bundle" "$here/dynamic/openapps.yaml"

# Nur lokal: das selbst signierte Standard-Zertifikat gehoert in dasselbe
# Verzeichnis, weil Traefiks File-Provider genau ein Verzeichnis liest.
cp "$here/tls.local.yml" "$here/dynamic/tls.local.yml"
echo "kopiert: $here/dynamic/tls.local.yml"
