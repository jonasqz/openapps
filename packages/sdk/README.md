# @openapps/sdk

Der Client, den jede App auf der Plattform benutzt. Zweck: Eine App enthält
keinen Auth- und keinen Rechte-Code (CLAUDE.md Grundsatz 3, AGENTS.md Regeln 1
und 2). Das Gateway prüft jeden Aufruf, die DB-Rolle begrenzt jeden Zugriff —
dieses Paket ist die Stelle, an der eine App beides korrekt benutzt.

## Nutzer aus den Gateway-Headern

```ts
import { getUser } from '@openapps/sdk';

export async function GET(request: Request) {
  const user = getUser(request.headers); // wirft, wenn der Aufruf nicht vom Gateway kam
  return Response.json({ id: user.id, groups: user.groups });
}
```

`getUser` liest die fünf Identitäts-Header, die das Gateway setzt — aber
**nur**, wenn die Signatur darüber stimmt. Sonst wirft es
`UntrustedRequestError` (Status 401). Es gibt keinen anonymen Nutzer und keinen
Fallback.

| Header | Inhalt |
| --- | --- |
| `X-Auth-User-Id` | Stabile ID des Nutzers |
| `X-Auth-User-Email` | E-Mail aus dem Google-SSO |
| `X-Auth-Groups` | Gruppen, kommagetrennt |
| `X-Auth-Issued-At` | Unix-Zeit der Entscheidung, in Sekunden |
| `X-Auth-Signature` | HMAC-SHA256 über die vier Werte oben plus Host und App-Id |

Alle fünf werden immer gesetzt, auch mit leeren Werten (Spec 3.1). Ein leerer,
aber korrekt mitsignierter Nutzer wird abgewiesen — ein signiertes „niemand“ ist
kein Nutzer.

Das Signal ist bewusst ein HMAC über die Identitätsangaben und kein geteiltes
Geheimnis: Ein Token belegt nur, dass *irgendein* Aufruf vom Gateway kam, nicht,
dass *diese* Nutzerangaben vom Gateway stammen (ADR 0004).

### Das Signatur-Material

Gateway und App müssen das Material **Byte für Byte** gleich bilden, sonst ist
die Prüfung eine Zufallsprüfung. Sechs Felder in genau dieser Reihenfolge, jedes
mit einem Längenpräfix in UTF-8-Bytes:

```
openapps-forward-auth/1\n
<bytes>:<app-id>\n
<bytes>:<host>\n
<bytes>:<x-auth-user-id>\n
<bytes>:<x-auth-user-email>\n
<bytes>:<x-auth-groups>\n
<bytes>:<x-auth-issued-at>\n
```

Beispiel:

```
openapps-forward-auth/1
12:projektliste
26:projektliste.apps.blyck.de
7:usr_123
14:jonas@blyck.de
11:team,admins
10:1762680000
```

- Die Werte gehen **unverändert** ein, so wie sie als Header-Werte ankommen:
  nicht getrimmt, nicht kleingeschrieben, Gruppen nicht sortiert. Jede
  Normalisierung müsste das Gateway identisch vornehmen.
- `host` ist immer die eigene App-Domain aus `OPENAPPS_APP_HOST`, nie der Host
  aus der Anfrage. Eine Signatur für eine andere Domain passt damit nicht.
- Längenpräfixe statt Trennzeichen, weil jedes Trennzeichen Feldgrenzen
  verschiebbar macht: `usr_12` + `3jonas@blyck.de` und `usr_123` +
  `jonas@blyck.de` wären naiv verkettet dasselbe Material — zwei Identitäten,
  ein Beweis.
- Schlüssel sind die UTF-8-Bytes von `OPENAPPS_AUTH_SECRET`, Ausgabe ist Hex in
  Kleinbuchstaben. Verglichen wird zeitkonstant.

`signatureFor()` und `signatureMaterial()` sind exportiert, damit die Control
Plane dieselbe Funktion benutzt statt sie nachzubauen.

### Was zusätzlich geprüft wird

1. `X-Auth-Issued-At` liegt höchstens 60 s zurück und nicht in der Zukunft.
   Fenster (`maxAgeSeconds`), Vorlauf (`futureToleranceSeconds`) und die
   Uhr-Quelle (`now`) sind injizierbar.
2. Richtet sich der Aufruf sichtbar an eine andere Domain
   (`X-Forwarded-Host`, sonst `Host`), wird er mit klarer Meldung abgewiesen,
   bevor die Signatur geprüft wird. Der Host aus der Anfrage ist dabei nie die
   Quelle der Wahrheit — er wird nur verglichen.

### Annahmen an die Infrastruktur

Relevant für die Traefik-Forward-Auth in Woche 1:

1. Das Gateway setzt alle fünf Identitäts-Header auf jedem Aufruf an eine App —
   immer, auch mit leeren Werten.
2. Das Gateway **entfernt** alle `X-Auth-*` Header der eingehenden Anfrage,
   bevor es die eigenen setzt. Das gilt für alle fünf, nicht nur für die
   Signatur: Vergisst ein Traefik-Label das, reicht Traefik einen vom Client
   mitgeschickten Header unverändert durch, und das Modell ist wertlos. Dieser
   Punkt gehört in die Regressionstests und in den Label-Lint.
3. Gateway und App kennen dasselbe Secret: Die Control Plane erzeugt es pro App
   und gibt es nur als Env-Variable in diese App und ins Gateway. Mindestens 32
   Zeichen, sonst bedient die App keinen Aufruf. Rotation heißt Redeploy — es
   gibt absichtlich keinen Übergangspfad mit zwei Secrets.
4. Gateway und App haben eine ungefähr gleiche Uhr. Driftet sie um mehr als das
   Fenster, kommt niemand mehr durch — ein Ausfall, kein Loch, aber er muss
   überwacht werden.

### Was der HMAC nicht leistet

Er belegt Herkunft und Unverändertheit der Angaben, **nicht** dass niemand
mitliest. Header und Signatur gehen im Klartext über die Strecke Gateway → App;
wer dort mitlesen kann, kennt die Identität des Nutzers und kann die Signatur
innerhalb des Fensters für dieselbe Domain erneut verwenden. Dagegen schützt nur
die Netztrennung aus Spec 3.3 (kein veröffentlichter Host-Port, nur das
Gateway-Netz) oder TLS auf der Strecke. Ebenso schützt er nicht gegen ein
geleaktes Secret — wer es kennt, kann beliebige Nutzerangaben signieren.

## Postgres-Client

```ts
import { createAppPool } from '@openapps/sdk';

const pool = createAppPool(); // DATABASE_URL + DATABASE_SCHEMA aus der Env
const { rows } = await pool.query('select id, name from projects order by name');
```

- `search_path` ist als Startup-Option der Verbindung festgelegt
  (`-c search_path=<schema>`), nicht per `SET` danach: Er gilt ab der ersten
  Anweisung. `public` steht absichtlich nicht im Pfad — sonst trifft ein
  unqualifizierter Name still eine fremde Tabelle.
- Eine Verbindungszeichenfolge, die nach Owner- oder Superuser-Rolle aussieht
  (`postgres`, `root`, `*_owner`, `*_admin`, …), wird abgewiesen, bevor
  verbunden wird. Mit `expectedRole` kann die Control Plane die von ihr
  angelegte Rolle festnageln.
- Ein `options=` oder `search_path=` in der URL ist ein Fehler: Den
  `search_path` setzt das SDK, nicht die Env (Regel 2, kein
  `search_path`-Trick).

Die eigentliche Grenze zieht Postgres. Dieses Modul ist die Hürde davor, damit
eine falsch gesetzte Env beim Start auffällt und nicht erst, wenn eine App Daten
einer anderen liest.

## Fehler

| Fehler | Status | Bedeutung |
| --- | --- | --- |
| `UntrustedRequestError` | 401 | Signal oder Nutzer-Header fehlen bzw. stimmen nicht. |
| `SdkConfigurationError` | 500 | Die App ist falsch konfiguriert (fehlende oder schwache Env). |

Beide erben von `SdkError` und tragen `status`, den eine App unverändert als
HTTP-Status zurückgeben kann.

## Env

| Variable | Secret | Zweck |
| --- | --- | --- |
| `OPENAPPS_AUTH_SECRET` | ja | HMAC-Schlüssel für die Identitäts-Header. Mindestens 32 Zeichen. |
| `OPENAPPS_APP_ID` | nein | App-Id im Signatur-Material. |
| `OPENAPPS_APP_HOST` | nein | Eigene App-Domain im Signatur-Material. |
| `DATABASE_URL` | ja | Verbindung mit der eigenen DB-Rolle. |
| `DATABASE_SCHEMA` | nein | Das eigene Schema der App. |

Jede App deklariert diese fünf in ihrem `app.json` (AGENTS.md Regel 5).

## Scripts

```bash
pnpm --filter @openapps/sdk build
pnpm --filter @openapps/sdk typecheck
pnpm --filter @openapps/sdk test
```
