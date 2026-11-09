#!/usr/bin/env bash
# Nachweis fuer DoD 2: Keine App ist ohne Session erreichbar.
#
# Geprueft werden **Adressen**, nicht Domains: Jede App liegt unter einem Pfad
# auf der gemeinsamen Domain (ADR 0007). Eine Domainliste wuerde pro Lauf nur
# eine einzige Entscheidung pruefen und ueber die Apps nichts sagen.
#
# Laeuft zweimal: vor und nach einem Coolify-Update. Die groesste Annahme des
# Projekts ist, dass Coolify unsere dynamische Konfiguration nicht anfasst —
# dieses Skript ist die Stelle, an der sie faellt, wenn sie faellt.
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
# ## Zweiter Teil: die laufende Traefik-Konfiguration
#
# Dieselben Pruefungen, die der Startup-Check der Control Plane macht
# (apps/control-plane/src/infra/gateway-guard.ts). Sie stehen hier zusaetzlich
# als Shell, damit der Nachweis nach einem Coolify-Update auch ohne laufende
# Control Plane gefuehrt werden kann.
#
# Fassung 2, nach ADR 0008: Geprueft wird **jeder unserer Router**, nicht mehr
# die Middleware-Kette am Entrypoint. Diese Kette gibt es nicht mehr —
# Entrypoints stehen in Traefiks statischer Konfiguration, die gehoert Coolify,
# und wir fassen sie nicht an. Der Schutz haengt jetzt an jedem einzelnen
# Router, den unser Generator ausgibt. Eine Pruefung am Entrypoint waere heute
# ein gruener Lauf ueber nichts.
#
# Geprueft wird, in dieser Reihenfolge:
#   1. Beide Middlewares gibt es in der laufenden Konfiguration und sie sind
#      `enabled`.
#   2. Jeder Router mit dem Praefix `openapps-` traegt genau
#      [strip, forward-auth] in dieser Reihenfolge und ist `enabled`.
#   3. Den Catch-all gibt es und er ist `enabled`.
#   4. `forwardedHeaders` an unserem Entrypoint ist leer — sonst bestimmt der
#      Aufrufer `X-Forwarded-Host` und damit die Pfad-Allowlist aus Spec 1.3.
#      Dieser Entrypoint gehoert Coolify; genau deshalb wird er gemessen und
#      nicht gesetzt.
#
# Adresse der API ueber TRAEFIK_API_URL (z. B. http://127.0.0.1:8081),
# Entrypoint ueber GATEWAY_ENTRYPOINT (Default `https`, wie bei Coolify).
# Ohne Adresse oder ohne erreichbare API wird dieser Teil **sichtbar**
# uebersprungen — eine stumme API ist kein Befund darueber, ob der Schutz
# haengt.
#
# Die Auswertung liegt in **einem** Python-Programm und nicht zusaetzlich in
# jq: Zwei Fassungen derselben Sicherheitspruefung koennen auseinanderlaufen,
# und dann sagt ein gruener Lauf nichts mehr. Fehlt python3, wird dieser Teil
# uebersprungen, nicht geraten.

set -euo pipefail

urls_file="${1:-infra/app-urls.txt}"
login_host="${OPENAPPS_LOGIN_HOST:-}"
traefik_api="${TRAEFIK_API_URL:-}"
entrypoint="${GATEWAY_ENTRYPOINT:-https}"
failed=0
checked=0

skip() {
  printf '%-60s %-6s %s\n' '(Traefik-API)' '-' "UEBERSPRUNGEN: $1"
}

# Gibt 0 zurueck, wenn alle Pruefungen stehen, 1 bei einem Verstoss, und
# laesst den Exit-Code unberuehrt, wenn nichts geprueft werden konnte.
check_traefik_config() {
  if [[ -z "$traefik_api" ]]; then
    skip 'TRAEFIK_API_URL nicht gesetzt — Router, Middlewares und forwardedHeaders ungeprueft'
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    skip 'python3 fehlt — Router, Middlewares und forwardedHeaders ungeprueft'
    return 0
  fi

  local base routers middlewares entrypoints payload output rc
  base="${traefik_api%/}"

  for part in routers middlewares entrypoints; do
    local url
    case "$part" in
      routers) url="${base}/api/http/routers" ;;
      middlewares) url="${base}/api/http/middlewares" ;;
      entrypoints) url="${base}/api/entrypoints" ;;
    esac
    local body
    if ! body="$(curl -sS -f -m 10 "$url" 2>/dev/null)"; then
      skip "${url} nicht erreichbar — kein Befund ueber den Schutz"
      return 0
    fi
    case "$part" in
      routers) routers="$body" ;;
      middlewares) middlewares="$body" ;;
      entrypoints) entrypoints="$body" ;;
    esac
  done

  payload="$(printf '{"routers":%s,"middlewares":%s,"entrypoints":%s,"entrypoint":"%s"}' \
    "$routers" "$middlewares" "$entrypoints" "$entrypoint")"

  # `… && rc=0 || rc=$?` statt `set +e`: ein globales Umschalten von errexit in
  # einer Funktion wuerde die Einstellung des Aufrufers ueberschreiben.
  output="$(printf '%s' "$payload" | python3 -I "$(dirname "$0")/traefik-guard.py")" && rc=0 || rc=$?

  if [[ "$rc" -eq 2 ]]; then
    skip "${base} antwortet nichts Verwertbares — kein Befund ueber den Schutz"
    return 0
  fi

  # Das Programm schreibt Zeilen `STATUS<TAB>LABEL<TAB>TEXT`.
  while IFS=$'\t' read -r status label text; do
    [[ -z "$status" ]] && continue
    printf '%-60s %-6s %s\n' "$label" "$status" "$text"
  done <<<"$output"

  [[ "$rc" -eq 0 ]] && return 0
  return 1
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
