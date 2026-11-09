#!/usr/bin/env bash
# Nachweis fuer DoD 2: Keine App-Domain ist ohne Session erreichbar.
#
# Laeuft zweimal: vor und nach einem Coolify-Update. Die groesste Annahme des
# Projekts ist, dass die Traefik-Forward-Auth ein Update ueberlebt — dieses
# Skript ist die Stelle, an der sie faellt, wenn sie faellt.
#
#   infra/scripts/check-auth.sh domains.txt
#
# domains.txt: eine App-Domain pro Zeile, Kommentare mit #.
# Erwartet wird pro Domain 401, 403 oder eine Weiterleitung auf den Login.
# Alles andere — auch ein 200, auch ein 502 — ist ein Fehlschlag: ein Dienst,
# der nicht antwortet, ist kein Beweis dafuer, dass er geschuetzt ist.

set -euo pipefail

domains_file="${1:-infra/domains.txt}"
login_host="${OPENAPPS_LOGIN_HOST:-}"
failed=0
checked=0

if [[ ! -f "$domains_file" ]]; then
  echo "Keine Domainliste: $domains_file" >&2
  exit 2
fi

printf '%-45s %-6s %s\n' DOMAIN STATUS ERGEBNIS

while IFS= read -r domain; do
  domain="${domain%%#*}"
  domain="$(printf '%s' "$domain" | tr -d '[:space:]')"
  [[ -z "$domain" ]] && continue
  checked=$((checked + 1))

  read -r status location < <(
    curl -sS -o /dev/null -m 15 \
      -w '%{http_code} %{redirect_url}\n' \
      "https://${domain}/" 2>/dev/null || echo '000 -'
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

  printf '%-45s %-6s %s\n' "$domain" "$status" "$verdict"
done <"$domains_file"

echo
if [[ "$checked" -eq 0 ]]; then
  echo "Keine Domain geprueft. Das ist kein Nachweis." >&2
  exit 2
fi

if [[ "$failed" -gt 0 ]]; then
  echo "${failed} von ${checked} Domains durchgefallen. DoD 2 nicht erfuellt." >&2
  exit 1
fi

echo "${checked} Domains geprueft, alle ohne Session abgewiesen."
