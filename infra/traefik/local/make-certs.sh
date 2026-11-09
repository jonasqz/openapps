#!/usr/bin/env bash
# Selbst signiertes Zertifikat fuer *.local.test, nur fuer den lokalen Lauf.
# Die Dateien sind gitignoriert; sie sind kein Secret der Plattform, sondern
# Wegwerf-Material fuer den Nachweis.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/certs"
mkdir -p "$out"
[[ -f "$out/local.crt" ]] && exit 0
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout "$out/local.key" -out "$out/local.crt" \
  -subj '/CN=local.test' \
  -addext 'subjectAltName=DNS:local.test,DNS:*.local.test' >/dev/null 2>&1
echo "Zertifikat erzeugt: $out/local.crt"
