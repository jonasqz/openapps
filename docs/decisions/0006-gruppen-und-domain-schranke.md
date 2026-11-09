# ADR 0006: Gruppen liegen in der Control Plane, Mitgliedschaft über die E-Mail

Stand 2026-11-09 · angenommen

## Kontext

Better Auth bringt Google-SSO. Damit ist geklärt, **wer** jemand ist — nicht,
**was** er darf. Das Rechtemodell kennt Freigaben an Gruppen
(`docs/01-architektur.md`), also muss irgendwo stehen, wer in welcher Gruppe
ist.

Ein früherer Kommentar im Code behauptete, die Gruppen kämen „aus dem
Google-SSO-Claim". Das ist falsch: Google liefert ohne das Workspace-Admin-SDK
keine Gruppen. Die Annahme hätte beim ersten echten Login gekippt.

Dazu ein zweites Problem, das beim Verdrahten sichtbar wurde: Mit Google-SSO
und ohne Schranke kann sich **jeder Mensch mit einem Google-Konto** ein Konto
auf der Plattform anlegen. Er käme ohne Freigabe nirgends hin, aber er stünde
in der Nutzertabelle.

## Entscheidung

**Gruppen liegen in der Control Plane**, in `groups` und `group_members`, neben
`grants` — sie sind Rechtemodell, nicht Login-Zustand. Google liefert nur die
Identität.

**Mitgliedschaft hängt an der E-Mail-Adresse**, nicht an der Nutzer-Id.

**Eine Domain-Schranke ist Pflicht:** `AUTH_ALLOWED_EMAIL_DOMAINS` wird beim
Anlegen eines Kontos **und** bei jedem Login geprüft. Exakter Domain-Vergleich,
kein Suffix, keine Subdomain. **Ist die Variable leer, wird keine Anmeldung
zugelassen** — nicht jede.

**Der erste Zugang kommt aus der Env:** Wer in `AUTH_BOOTSTRAP_ADMINS` steht,
landet bei jedem Login in `platform-admins` — der Gruppe, die Migration `0006`
bereits den Wildcard-Grant gegeben hat.

## Folgen

- Die Nutzer-Zeile entsteht erst beim ersten Login. Hinge die Mitgliedschaft an
  der Nutzer-Id, könnte man niemanden *vorher* in eine Gruppe setzen — und
  genau das braucht der Bootstrap. Über die E-Mail geht es.
- **Der Preis:** Wird eine Adresse im Workspace an eine andere Person vergeben,
  erbt diese die Mitgliedschaften. Dagegen stehen die Domain-Schranke, die
  Pflege im Workspace und die Tatsache, dass jede Mitgliedschaft widerrufbar
  ist. Für ein internes Team mit einem Google-Workspace ist das tragbar; für
  Mandantenbetrieb wäre es keine Antwort — Managed ist ein Nicht-Ziel in v1.
- Die leere Variable sperrt alles aus. Das ist Absicht und folgt dem
  Default-Deny: Ein vergessener Wert soll die Plattform unbenutzbar machen,
  nicht offen.
- Gruppen werden **pro Aufruf** aus der Datenbank gelesen, ohne Cache. Eine
  entzogene Mitgliedschaft wirkt beim nächsten Aufruf, wie ein widerrufener
  Grant.
- Die Auth-Tabellen von Better Auth liegen im Schema `control_plane`, nicht in
  `public`: ein neues Schema hat keine PUBLIC-Rechte, Sessions und
  OAuth-Token sind damit für keine App-Rolle sichtbar. `groups` und
  `group_members` liegen bewusst in `public` bei `grants`, weil sie in
  denselben Abfragen gelesen werden.
- **Noch offen:** Gruppenpflege hat weder Endpunkt noch MCP-Tool. „Agents
  first" verlangt `grant_group_member` und `revoke_group_member`, bevor es
  dafür eine Oberfläche gibt. Bis dahin pflegt man Mitgliedschaften per SQL
  oder über die Bootstrap-Variable.

## Alternativen

- **Gruppen aus einem Google-Claim.** Verworfen, weil es sie nicht gibt: Es
  bräuchte das Workspace-Admin-SDK, ein weiteres Zugriffsrecht und eine
  Abhängigkeit von Google für eine Frage, die das Rechtemodell beantwortet.
  Widerspricht auch Grundsatz 4 in `CLAUDE.md` — Freigaben liegen zentral in
  der Control Plane, nirgends sonst.
- **Mitgliedschaft über die Nutzer-Id**, mit Fremdschlüssel. Verworfen: Der
  Fremdschlüssel verbietet genau den Bootstrap, und das Henne-Ei-Problem muss
  irgendwo gelöst werden.
- **Keine Domain-Schranke, nur Freigaben.** Verworfen: Ein Konto ohne Freigabe
  ist harmlos, aber eine offene Registrierung auf einer internen Plattform ist
  keine Verteidigungslinie, die man weglässt. Zwei Schranken sind hier richtig.
