#!/usr/bin/env bash
# Nachweis fuer DoD 2 gegen den lokalen Stapel aus ../docker-compose.yml.
#
# Acht Faelle, jeder mit dem, was wirklich zurueckkam. Faellt einer, ist die
# Konfiguration falsch, nicht der Test.
#
#   ./make-certs.sh && docker compose up -d && ./nachweis.sh
#
# Ergebnis nach docs/nachweise/dod-02-laeufe/<datum>-lokal.txt umleiten.

set -uo pipefail

port="${OPENAPPS_HTTPS_PORT:-8443}"
compose=(docker compose -f "$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml")
failed=0

# curl gegen den lokalen Entrypoint: -k wegen des selbst signierten
# Zertifikats, --resolve statt DNS, kein Folgen von Weiterleitungen.
req() {
  local host="$1" path="$2"
  shift 2
  curl -sS -k -o /tmp/openapps-nachweis-body -D /tmp/openapps-nachweis-head \
    -w '%{http_code}' -m 20 \
    --resolve "${host}:${port}:127.0.0.1" "$@" \
    "https://${host}:${port}${path}" 2>/dev/null || echo 000
}

result() { # name erwartet ist zusatz
  local name="$1" want="$2" got="$3" extra="${4:-}"
  if [[ "$got" == "$want" ]]; then
    printf 'OK    %-42s erwartet=%-12s bekommen=%-12s %s\n' "$name" "$want" "$got" "$extra"
  else
    printf 'FEHLT %-42s erwartet=%-12s bekommen=%-12s %s\n' "$name" "$want" "$got" "$extra"
    failed=$((failed + 1))
  fi
}

echo "# Nachweis DoD 2 (lokal) $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "# traefik: $(docker image inspect traefik:v3.3 --format '{{index .RepoDigests 0}}' 2>/dev/null)"
echo

echo '## 1. App mit Router und Freigabe -> 200, fuenf X-Auth-Header in der App'
code="$(req app1.local.test /)"
hdrs="$(grep -o '"X-Auth-[A-Za-z-]*"' /tmp/openapps-nachweis-body | sort -u | tr -d '"' | paste -sd, -)"
result 'app1 / (Freigabe)' 200 "$code" "angekommen=[$hdrs]"
[[ "$(grep -c -o '"X-Auth-' /tmp/openapps-nachweis-body)" == 5 ]] ||
  { echo "FEHLT  nicht alle fuenf Header in der App angekommen"; failed=$((failed + 1)); }
echo

echo '## 2. Stub antwortet 403 -> 403, App wird nicht erreicht'
code="$(req app1.local.test /deny)"
body="$(head -c 200 /tmp/openapps-nachweis-body)"
result 'app1 /deny' 403 "$code" "body=$(printf '%s' "$body" | tr '\n' ' ')"
grep -q '"app"' /tmp/openapps-nachweis-body &&
  { echo 'FEHLT  App-Inhalt in der 403-Antwort'; failed=$((failed + 1)); }
echo

echo '## 3. Keine Session -> 302 auf den Login'
code="$(req app1.local.test /nosession)"
loc="$(grep -i '^location:' /tmp/openapps-nachweis-head | tr -d '\r')"
result 'app1 /nosession' 302 "$code" "$loc"
echo

echo '## 4. Client schickt X-Auth-Header selbst mit -> erreicht die App nicht'
code="$(req app1.local.test / \
  -H 'X-Auth-User-Id: admin' \
  -H 'X-Auth-User-Email: eve@example.invalid' \
  -H 'X-Auth-Groups: admins' \
  -H 'X-Auth-Issued-At: 9999999999' \
  -H 'X-Auth-Signature: gefaelscht')"
smuggled="$(grep -c -E '"(admin|admins|gefaelscht|eve@example.invalid|9999999999)"' /tmp/openapps-nachweis-body)"
result 'app1 / mit gefaelschten Headern' 200 "$code" "gefaelschte Werte in der App=$smuggled"
if [[ "$smuggled" != 0 ]]; then
  echo 'FEHLT  ein gefaelschter Header hat die App erreicht'
  failed=$((failed + 1))
  grep -n 'X-Auth' /tmp/openapps-nachweis-body
fi
echo

echo '## 5. Domain ohne Router -> 403'
code="$(req unbekannt.local.test /)"
deny="$(grep -i '^x-openapps-deny:' /tmp/openapps-nachweis-head | tr -d '\r')"
result 'unbekannt.local.test /' 403 "$code" "quelle=${deny:-control-plane}"
echo '## 5b. Dieselbe Domain, Stub sagt absichtlich 200 -> Deny-Backend muss sperren'
code="$(req unbekannt.local.test /force-allow)"
deny="$(grep -i '^x-openapps-deny:' /tmp/openapps-nachweis-head | tr -d '\r')"
result 'unbekannt.local.test /force-allow' 403 "$code" "quelle=${deny:-unbekannt}"
echo

echo '## 6. App ohne Traefik-Labels (Coolify-Update-Fall) -> 403, nicht 200'
"${compose[@]}" up -d app3-ohne-labels >/dev/null 2>&1
sleep 3
code="$(req nolabels.local.test /)"
deny="$(grep -i '^x-openapps-deny:' /tmp/openapps-nachweis-head | tr -d '\r')"
result 'nolabels.local.test / (Stub sagt 200)' 403 "$code" "quelle=${deny:-unbekannt}"
grep -q '"app"' /tmp/openapps-nachweis-body &&
  { echo 'FEHLT  App ohne Labels war erreichbar'; failed=$((failed + 1)); }
echo

echo '## 7. Control-Plane-Stub gestoppt -> kein Durchlass, fuer alle Domains'
"${compose[@]}" stop control-plane >/dev/null 2>&1
for host in app1.local.test app2.local.test unbekannt.local.test; do
  code="$(req "$host" /)"
  if [[ "$code" =~ ^5[0-9][0-9]$ ]]; then
    printf 'OK    %-42s erwartet=5xx          bekommen=%s\n' "$host" "$code"
  else
    printf 'FEHLT %-42s erwartet=5xx          bekommen=%s\n' "$host" "$code"
    failed=$((failed + 1))
  fi
done
"${compose[@]}" start control-plane >/dev/null 2>&1
sleep 3
echo

echo '## 8. Stub antwortet langsam (>2 s) -> Abbruch, kein Durchlass'
start=$(date +%s)
code="$(req app1.local.test /slow)"
dauer=$(( $(date +%s) - start ))
if [[ "$code" =~ ^5[0-9][0-9]$ ]]; then
  printf 'OK    %-42s erwartet=5xx          bekommen=%-12s nach %ss\n' 'app1 /slow' "$code" "$dauer"
else
  printf 'FEHLT %-42s erwartet=5xx          bekommen=%-12s nach %ss\n' 'app1 /slow' "$code" "$dauer"
  failed=$((failed + 1))
fi
grep -q '"app"' /tmp/openapps-nachweis-body &&
  { echo 'FEHLT  App trotz Timeout erreicht'; failed=$((failed + 1)); }
echo

echo "## Startup-Check: Entrypoint-Middlewares laut Traefik-API"
curl -sS -m 5 "http://127.0.0.1:${OPENAPPS_TRAEFIK_API_PORT:-8081}/api/entrypoints" |
  tr ',' '\n' | grep -i -A2 -B2 'middleware' || echo '(API nicht erreichbar)'
echo

echo "## Ergebnis: $failed Fehlschlag(e)"
[[ "$failed" == 0 ]] || exit 1
