# ADR 0004: Das Gateway-Signal ist ein HMAC, kein geteiltes Geheimnis

Stand 2026-11-09 · angenommen

## Kontext

Regel 1 der Plattform sagt: Apps bauen keinen Login, der Nutzer kommt aus den
Headern des Gateways. Damit steht und fällt alles an der Frage, wie eine App
erkennt, dass ein Aufruf wirklich durch das Gateway kam. Ein Angreifer, der die
`X-Auth-*`-Header selbst setzt, darf nicht durchkommen.

Zwei Entwürfe entstanden parallel und widersprachen sich:

| | Geteiltes Geheimnis | HMAC über die Identitätsheader |
| --- | --- | --- |
| Was mitkommt | ein Token pro Deployment in einem Header | Signatur über Nutzer-Id, E-Mail, Gruppen, Zeit, Host, App-Id |
| Belegt | die Herkunft des Aufrufs | Herkunft **und** Unverändertheit der Nutzerangaben |
| Abgefangener Wert | gilt unbegrenzt und für jede Domain | nach 60 s wertlos, gilt nur für diese Domain |
| Braucht | nichts | eine ungefähr gleiche Uhr auf Gateway und App |
| Rotation | nur per Redeploy | nur per Redeploy |

## Entscheidung

**HMAC**, wie in [`../specs/woche-1-forward-auth.md`](../specs/woche-1-forward-auth.md)
Abschnitt 3 beschrieben: `X-Auth-Signature` als HMAC-SHA256 über Nutzer-Id,
E-Mail, Gruppen und `X-Auth-Issued-At`, dazu Host und App-Id, mit dem
App-eigenen Secret aus `OPENAPPS_AUTH_SECRET`. Gültigkeitsfenster 60 Sekunden.
Alle sechs Header werden immer gesetzt, auch mit leeren Werten.

`@openapps/sdk` zieht nachträglich nach; die erste Fassung mit dem geteilten
Token `X-OpenApps-Gateway-Token` wird ersetzt, nicht ergänzt.

## Folgen

- Das Gateway muss alle `X-Auth-*`-Header der eingehenden Anfrage **entfernen**,
  bevor es die eigenen setzt. Vergisst ein Traefik-Label das, ist das Modell
  wertlos. Dieser Punkt gehört in die Regressionstests aus Woche 1 und in den
  Label-Lint, nicht in eine Fußnote.
- Gateway und App brauchen eine ungefähr gleiche Uhr. Driftet sie um mehr als
  60 Sekunden, kommt niemand mehr durch — ein Ausfall, kein Loch. Das ist die
  richtige Richtung, aber es muss überwacht werden.
- Die Annahme bleibt, dass der App-Container nur über das Gateway erreichbar
  ist (Spec 3.3). Das Signal belegt die Herkunft der Angaben, nicht, dass
  niemand mitliest.
- Rotation heißt weiter Redeploy. Reicht das nicht, akzeptiert das SDK während
  eines Übergangs zwei Secrets. Jetzt nicht eingebaut, um den Pfad nicht
  aufzuweichen.
- `AGENTS.md` Regel 1 nennt jetzt alle fünf Header und sagt, dass nur
  `getUser` sie prüfen darf.
- Jede App braucht drei neue Env-Variablen, die die Control Plane pro
  Deployment setzt: `OPENAPPS_AUTH_SECRET`, `OPENAPPS_APP_ID` und
  `OPENAPPS_APP_HOST`. `OPENAPPS_APP_ID` und `OPENAPPS_APP_HOST` müssen
  byte-gleich dem entsprechen, was das Gateway ins Signatur-Material
  schreibt — sonst passt keine Signatur.

## Alternativen

- **Geteiltes Geheimnis.** Verworfen: Es belegt nur, dass *irgendein* Aufruf vom
  Gateway kam, nicht, dass *diese* Nutzerangaben vom Gateway stammen. Wer den
  Token einmal sieht, kann sich dauerhaft als beliebiger Nutzer ausgeben. Der
  Mehraufwand des HMAC ist eine Zeile Kryptografie im SDK.
- **mTLS zwischen Gateway und App.** Verworfen für v1: Zertifikatsverteilung und
  -erneuerung pro App sind mehr Betrieb, als das 2-h-pro-Woche-Ziel trägt. Bleibt
  der Weg, falls die Netztrennung aus Spec 3.3 nicht hält.
- **Signierte JWTs statt HMAC über Header.** Verworfen: gleiche Sicherheit,
  mehr Format. Der Vorteil (Prüfung ohne gemeinsames Secret) zählt erst, wenn
  Dritte die Angaben prüfen müssen — das ist in v1 niemand.
