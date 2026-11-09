# @openapps/control-plane

Die einzige eigene App des Layers. Sie führt das Register der Apps, hält **das
eine** Rechtemodell, betreibt das Review-Gate, schreibt das Audit-Log und
steuert Deploy- und Repo-Backend.

## Aufbau

```
migrations/              aufsteigend numeriert, vorwärts, nie geändert
src/domain/              Domänenlogik — ohne HTTP, ohne Anbieternamen
  can.ts                 die eine Rechteprüfung (Default-Deny, kein Cache)
  apps.ts                createApp (legt das Repo an), listApps
  deployments.ts         requestDeploy, rollback, Env und Gateway pro App
  grants.ts              grant, revoke
  gateway-headers.ts     die fünf Identitäts-Header, signiert über das SDK
  gateway-identity.ts    App-Id und Host — eine Quelle für Signatur und Env
  app-secret.ts          OPENAPPS_AUTH_SECRET pro App, abgeleitet
  manifest-grants.ts     Übersetzung Manifest → Rechtemodell (`human` → `user`)
  review-gate/           Pipeline, Schritte, Zusammenführung
src/adapters/coolify/    der einzige Ort, der Coolify kennt
src/adapters/github/     der einzige Ort, der GitHub kennt
src/infra/pg/            Repositories, Provisioner, Migrations-Läufer
src/infra/memory/        Speicher im Prozess plus Doubles (Tests, Entwicklung)
src/lib/                 Env, Session, HTTP-Abbildung, Zusammensetzung
src/app/api/             Route-Handler — rufen nur die Domäne
src/app/                 zwei Seiten: Apps und Freigaben
tests/                   die riskanten Pfade (DoD 1, 3, 4, 5)
docker-compose.yml       Test-Postgres für die Nachweise zu DoD 3
```

## Die fünf Regeln dieses Pakets

1. **Agents first.** Jede Aktion ist zuerst Domänenfunktion, dann Endpunkt und
   MCP-Tool, zuletzt Button. `src/app/api` enthält keine Logik.
2. **Default-Deny.** `can` gibt `false` zurück, solange keine passende, nicht
   widerrufene Freigabe existiert. Es gibt keinen Zweig ohne Freigabe.
3. **Kein Cache über Freigaben.** Jede Prüfung fragt den Speicher, damit ein
   Widerruf sofort wirkt (DoD 3).
4. **Coolify und GitHub nur im Adapter.** Außerhalb von `src/adapters/*` kommen
   die Namen nicht vor. Trägt einer nicht, wird ein Ordner ersetzt.
5. **Eine Implementierung pro Format.** Die Signatur der Identitäts-Header kommt
   aus `@openapps/sdk` (`signatureFor`). Diese App baut sie nicht nach — zwei
   Implementierungen desselben Formats driften, und zwar leise.

## Forward-Auth und die fünf Header

`GET /api/authz/forward` ist die Route, die Traefik pro Aufruf fragt (Spec
`docs/specs/woche-1-forward-auth.md` Abschnitt 1.1). Bei 200 setzt sie:

| Header              | Inhalt                                                 |
| ------------------- | ------------------------------------------------------ |
| `X-Auth-User-Id`    | Nutzer-Id aus Better Auth                              |
| `X-Auth-User-Email` | E-Mail                                                 |
| `X-Auth-Groups`     | Gruppen, mit Komma getrennt                            |
| `X-Auth-Issued-At`  | Unix-Sekunden der Entscheidung                         |
| `X-Auth-Signature`  | HMAC-SHA256, Hex, über App-Id, Host und die vier Werte |

Alle fünf werden immer gesetzt, auch leer. Die Traefik-Labels aus
`src/adapters/coolify/traefik.ts` entfernen zuerst alle mitgeschickten
`X-Auth-*`-Header (`openapps-strip-<app>`) und übernehmen danach genau diese
fünf aus der Antwort — ADR 0004 nennt das Vergessen dieses Schritts als den
Punkt, an dem das Modell wertlos wird. `missingForwardAuthLabels()` ist die
Grundlage für den Label-Lint aus der Spec.

### Das Secret pro App

`OPENAPPS_AUTH_SECRET` ist pro App verschieden und wird **nicht gespeichert**,
sondern abgeleitet: HKDF-SHA256 aus `OPENAPPS_AUTH_MASTER_SECRET`, der App-Id
und `apps.auth_secret_generation`. Folgen:

- In der Datenbank liegt kein App-Secret.
- Rotation einer App: Generation hochzählen, Redeploy.
- Rotation aller Apps: neues Master-Secret.
- Das Master-Secret ist der eine Punkt, an dem alles hängt. Es liegt nur in der
  Env der Control Plane und geht nie in eine App.

Die Control Plane setzt pro Deployment in die Env **der App**: `DATABASE_URL`,
`DATABASE_SCHEMA`, `OPENAPPS_APP_ID`, `OPENAPPS_APP_HOST` und
`OPENAPPS_AUTH_SECRET`. App-Id und Host kommen aus
`src/domain/gateway-identity.ts` — denselben Funktionen, die auch signieren.
Nur deshalb sind sie byte-gleich.

## Repo-Backend

`create_app` legt das Repo an, bevor es registriert. Scheitert das, wird nichts
registriert. Der Adapter liegt in `src/adapters/github` und kopiert das
Starter-Template (`POST /repos/{template}/generate`, kein Fork).

**Rechte, die der Token braucht** (`GITHUB_TOKEN`):

- _Fine-grained token_ auf die Organisation aus `GITHUB_OWNER`:
  `Administration: Read and write` (Repos anlegen) und
  `Contents: Read and write`. Das Template-Repo muss für den Token lesbar sein
  und als Template markiert sein.
- _Classic token_: `repo`. Für eine Organisation zusätzlich die Freigabe des
  Tokens durch die Organisation.

Mehr braucht der Adapter nicht: kein `delete_repo`, kein `workflow`, keine
Rechte auf andere Organisationen. Welcher Tokentyp eingesetzt wird, entscheidet
der Nutzer.

## Betrieb

```bash
pnpm --filter @openapps/control-plane migrate   # Migrationen vorwärts
pnpm --filter @openapps/control-plane dev       # Entwicklung
pnpm --filter @openapps/control-plane test      # DoD-Tests
```

Variablen stehen in `.env.example`. Secrets kommen nie in den Code.

## Nachweise

| Datei                             | Kriterium                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tests/create-app.spec.ts`        | DoD 1: Repo entsteht vor der Registrierung; scheitert es, wird nichts registriert                                    |
| `tests/grants.spec.ts`            | DoD 3 im Rechtemodell: blockiert → Freigabe → lesbar → Widerruf → blockiert                                          |
| `tests/grants-postgres.spec.ts`   | DoD 3 in Postgres: fremdes Schema gesperrt, `search_path`-Trick scheitert, keine Rolle mit `rolsuper`/`rolbypassrls` |
| `tests/review-gate.spec.ts`       | DoD 4: eingebautes Secret blockiert; ein Claude-Report allein gibt nie frei                                          |
| `tests/deployments.spec.ts`       | DoD 5: Rollback tauscht die Zeiger, Backend genau einmal gerufen                                                     |
| `tests/gateway-signature.spec.ts` | die Naht zum SDK: `getUser` nimmt die Signatur der Control Plane an und lehnt jede Abweichung ab                     |

### Tests gegen eine echte Postgres-Instanz

```bash
docker compose -f apps/control-plane/docker-compose.yml up -d
pnpm --filter @openapps/control-plane test
docker compose -f apps/control-plane/docker-compose.yml down -v
```

Ohne laufende Instanz überspringen sich diese Tests (`describe.skipIf`) und
melden das sichtbar. Ein fehlender Container ist ein fehlender Nachweis, kein
fehlgeschlagener — `pnpm check` bleibt auf einem Rechner ohne Docker grün.
