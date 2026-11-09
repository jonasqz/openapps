#!/usr/bin/env bash
# Nachweis fuer DoD 2: Keine App ist ohne Session erreichbar.
#
# Geprueft werden **Adressen**, nicht Domains: Jede App liegt unter einem Pfad
# auf der gemeinsamen Domain (ADR 0007). Eine Domainliste wuerde pro Lauf nur
# eine einzige Entscheidung pruefen und ueber die Apps nichts sagen.
#
# Laeuft zweimal: vor und nach einem Coolify-Update. Die groesste Annahme des
# Projekts ist, dass die Traefik-Forward-Auth ein Update ueberlebt — dieses
# Skript ist die Stelle, an der sie faellt, wenn sie faellt.
#
#   infra/scripts/check-auth.sh app-urls.txt
#
# app-urls.txt: eine Adresse pro Zeile, Kommentare mit #. Eine Zeile ohne
# Schema wird als https:// gelesen; `infra/app-urls.txt.example` zeigt, was in
# die Liste gehoert (Wurzel der Domain, ein Pfad ohne App, je App ihr Pfad und
# ein tieferer Pfad darunter).
# Erwartet wird pro Adresse 401, 403 oder eine Weiterleitung auf den Login.
# Alles andere — auch ein 200, auch ein 502 — ist ein Fehlschlag: ein Dienst,
# der nicht antwortet, ist kein Beweis dafuer, dass er geschuetzt ist.
#
# Zweiter Teil (seit dem Gateway-Lauf): zwei Pruefungen gegen die Traefik-API,
# dieselben, die der Startup-Check der Control Plane macht
# (apps/control-plane/src/infra/gateway-guard.ts). Sie stehen hier zusaetzlich
# als Shell, damit der Nachweis nach einem Coolify-Update auch ohne laufende
# Control Plane gefuehrt werden kann. Adresse ueber TRAEFIK_API_URL
# (z. B. http://127.0.0.1:8081). Ohne Adresse oder ohne erreichbare API wird
# dieser Teil **sichtbar** uebersprungen — eine stumme API ist kein Befund
# darueber, ob die Middleware haengt.
#
# Dieser zweite Teil prueft die Middleware am **Entrypoint**. Ob der Schutz
# dort haengen bleibt oder in eigene Router wandert, ist mit ADR 0007 offen
# (die Entscheidung haengt daran, ob Coolify eine eigene dynamische
# Konfiguration zulaesst). Bis sie gefallen ist, bleibt diese Pruefung, wie sie
# ist: Sie misst, was heute steht.

set -euo pipefail

urls_file="${1:-infra/app-urls.txt}"
login_host="${OPENAPPS_LOGIN_HOST:-}"
traefik_api="${TRAEFIK_API_URL:-}"
failed=0
checked=0

# Gegenstueck zu entryPoints.websecure.http.middlewares in
# infra/traefik/traefik.yml. Die Reihenfolge ist Teil der Sicherheit: erst
# strip, dann auth. Vertauscht kann ein Client seine eigenen X-Auth-*-Header
# mitschicken (ADR 0004).
expected_chain='openapps-strip-auth-headers@file,openapps-forward-auth@file'

# Liest aus /api/entrypoints zwei Zeilen: die Middleware-Kette von `websecure`
# als kommagetrennte Liste, dann die gesetzten Schluessel von
# forwardedHeaders. jq, wenn vorhanden, sonst python3.
parse_websecure() {
  if command -v jq >/dev/null 2>&1; then
    # Keine Liste heisst: Das ist keine Traefik-API. Dann wird nichts geprueft
    # und nichts behauptet — dieselbe Regel wie im Startup-Check.
    jq -e 'type == "array"' >/dev/null 2>&1 <<<"$1" || return 1
    jq -r '
      [.[] | select(.name == "websecure") | (.http.middlewares // []) | .[]] | join(",")
    ' <<<"$1" 2>/dev/null || return 1
    jq -r '
      [.[] | select(.name == "websecure") | (.forwardedHeaders // {}) | keys[]] | join(",")
    ' <<<"$1" 2>/dev/null || return 1
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -I -c '
import json, sys
data = json.load(sys.stdin)
if not isinstance(data, list):
    raise SystemExit(1)
eps = [e for e in data if isinstance(e, dict) and e.get("name") == "websecure"]
ep = eps[0] if eps else {}
http = ep.get("http") or {}
chain = http.get("middlewares") or []
fwd = ep.get("forwardedHeaders") or {}
print(",".join(str(m) for m in chain))
print(",".join(sorted(fwd.keys())) if isinstance(fwd, dict) else "unbekannte-form")
' || return 1
    return 0
  fi

  return 2
}

# Gibt 0 zurueck, wenn beide Pruefungen stehen, 1 bei einem Verstoss und
# laesst den Exit-Code unberuehrt, wenn nichts geprueft werden konnte.
check_traefik_config() {
  if [[ -z "$traefik_api" ]]; then
    printf '%-60s %-6s %s\n' '(Traefik-API)' '-' \
      'UEBERSPRUNGEN: TRAEFIK_API_URL nicht gesetzt — Middleware-Kette und forwardedHeaders ungeprueft'
    return 0
  fi

  local url body parsed chain forwarded rc
  url="${traefik_api%/}/api/entrypoints"

  if ! body="$(curl -sS -f -m 10 "$url" 2>/dev/null)"; then
    printf '%-60s %-6s %s\n' '(Traefik-API)' '-' \
      "UEBERSPRUNGEN: ${url} nicht erreichbar — Middleware-Kette und forwardedHeaders ungeprueft"
    return 0
  fi

  # Kein `set +e` hier: ein globales Umschalten von errexit in einer Funktion
  # wuerde die Einstellung des Aufrufers ueberschreiben. Die Form
  # `… && rc=0 || rc=$?` faengt den Fehlschlag ab, ohne errexit anzufassen.
  parsed="$(parse_websecure "$body")" && rc=0 || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    printf '%-60s %-6s %s\n' '(Traefik-API)' '-' \
      'UEBERSPRUNGEN: weder jq noch python3 vorhanden — Antwort nicht auswertbar'
    return 0
  fi
  if [[ "$rc" -ne 0 ]]; then
    printf '%-60s %-6s %s\n' '(Traefik-API)' '-' \
      "UEBERSPRUNGEN: ${url} antwortet nichts Verwertbares — kein Befund ueber die Middleware"
    return 0
  fi

  chain="$(printf '%s\n' "$parsed" | sed -n '1p')"
  forwarded="$(printf '%s\n' "$parsed" | sed -n '2p')"
  local bad=0

  if [[ "$chain" == "$expected_chain" ]]; then
    printf '%-60s %-6s %s\n' 'websecure.middlewares' 'ok' "$chain"
  else
    printf '%-60s %-6s %s\n' 'websecure.middlewares' 'FEHL' \
      "FEHLER: [${chain}] statt [${expected_chain}] — Schutz weg oder Reihenfolge vertauscht"
    bad=1
  fi

  if [[ -z "$forwarded" ]]; then
    printf '%-60s %-6s %s\n' 'websecure.forwardedHeaders' 'ok' 'leer (kein Client gilt als Proxy)'
  else
    printf '%-60s %-6s %s\n' 'websecure.forwardedHeaders' 'FEHL' \
      "FEHLER: gesetzt (${forwarded}) — X-Forwarded-Host waere vom Client bestimmbar (Spec 1.3)"
    bad=1
  fi

  return "$bad"
}

if [[ ! -f "$urls_file" ]]; then
  echo "Keine Adressliste: $urls_file" >&2
  exit 2
fi

printf '%-60s %-6s %s\n' PRUEFUNG STATUS ERGEBNIS

check_traefik_config && config_failed=0 || config_failed=$?
failed=$((failed + config_failed))
echo

while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [[ -z "$line" ]] && continue
  # Eine Zeile ohne Schema ist eine Adresse auf https. Kein Pfad angehaengt:
  # was in der Liste steht, wird genau so geprueft — ein Pfad ist unter
  # ADR 0007 Teil der Entscheidung und darf nicht vom Skript erfunden werden.
  url="$line"
  [[ "$url" == http://* || "$url" == https://* ]] || url="https://${url}"
  checked=$((checked + 1))

  read -r status location < <(
    curl -sS -o /dev/null -m 15 \
      -w '%{http_code} %{redirect_url}\n' \
      "$url" 2>/dev/null || echo '000 -'
  )

  case "$status" in
    401 | 403)
      verdict='ok (abgewiesen)'
      ;;
    301 | 302 | 303 | 307 | 308)
      if [[ -n "$login_host" && "$location" != *"$login_host"* ]]; then
        verdict="FEHLER (Weiterleitung nicht auf Login: ${location})"
        failed=$((failed + 1))
      else
        verdict='ok (Weiterleitung auf Login)'
      fi
      ;;
    000)
      verdict='FEHLER (keine Antwort — nicht als geschuetzt zaehlen)'
      failed=$((failed + 1))
      ;;
    *)
      verdict='FEHLER (ohne Session erreichbar oder unerwartet)'
      failed=$((failed + 1))
      ;;
  esac

  printf '%-60s %-6s %s\n' "$url" "$status" "$verdict"
done <"$urls_file"

echo
if [[ "$checked" -eq 0 ]]; then
  echo "Keine Adresse geprueft. Das ist kein Nachweis." >&2
  exit 2
fi

if [[ "$failed" -gt 0 ]]; then
  echo "${failed} Pruefung(en) durchgefallen (${checked} Adressen geprueft). DoD 2 nicht erfuellt." >&2
  exit 1
fi

echo "${checked} Adressen geprueft, alle ohne Session abgewiesen."
