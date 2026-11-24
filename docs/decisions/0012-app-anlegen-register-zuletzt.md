# ADR 0012: Beim Anlegen einer App kommt das Register zuletzt

Stand: 24.11.2026

## Kontext

`createApp` hatte vier Schritte: Repo anlegen, App ins Register schreiben,
Schema und Rolle anlegen, Domain setzen. Im ersten lokalen Lauf (ADR 0011)
scheiterte das Setzen der Domain. Die App stand danach im Register, aber ohne
Domain. Ein zweiter Versuch endete in „gibt es schon“, und jeder Deploy in
`gateway.missing_domain`. Es half nur, die Datenbank zurückzusetzen.

## Entscheidung

Der Eintrag im Register ist der letzte Schritt und ein einziges `INSERT`,
Domain inklusive (`NewApp.primaryDomain`). Die Reihenfolge ist:

1. Freigabe prüfen und Namen auf Konflikt prüfen.
2. Repo anlegen, außer eine Quelle wird mitgegeben.
3. Schema und Rolle anlegen. `provision_app_schema` ist idempotent.
4. Die App ins Register schreiben.

Scheitert ein Schritt, steht keine App im Register, und ein zweiter Versuch
mit demselben Namen geht durch.

## Folgen

- Es gibt keinen Zwischenstand „registriert, aber unvollständig“ mehr.
- Scheitert Schritt 3 oder 4, bleiben Schema und Rolle stehen. Das schadet
  nicht: Ohne Register-Eintrag nutzt sie niemand, und der nächste Versuch
  übernimmt sie und setzt ein neues Passwort.
- Scheitert Schritt 3 oder 4 nach einem neu angelegten Repo, bleibt das Repo
  stehen. Ein zweiter Versuch ohne Quelle scheitert dann beim Repo-Anbieter,
  weil der Name vergeben ist. Der Ausweg ist, das Repo als Quelle mitzugeben.
  Das ist sichtbar und behebbar, im Gegensatz zum alten Zustand.
- `setPrimaryDomain` bleibt für spätere Umzüge, `createApp` nutzt es nicht
  mehr.
- Tests: `tests/create-app.spec.ts` (Provisioning scheitert, dann zweiter
  Versuch; Domain ohne zweiten Schritt), `tests/apps-domain-postgres.spec.ts`
  (Domain im `INSERT`).

## Alternativen

- **Eine Datenbank-Transaktion über alle Schritte**: Das Repo liegt bei einem
  externen Anbieter, und `provision` legt Rollen an. Beides lässt sich nicht in
  dieselbe Transaktion nehmen. Verworfen.
- **Aufräumen bei Fehler** (die App wieder löschen): Das braucht eine
  Löschfunktion im Register, und das Aufräumen kann selbst scheitern. Verworfen,
  weil die neue Reihenfolge den Fall gar nicht erst entstehen lässt.
- **Status „angelegt, nicht fertig“ mit Fortsetzen**: Das wäre mehr Zustand
  für einen Fall, den die Reihenfolge schon verhindert. Verworfen.
