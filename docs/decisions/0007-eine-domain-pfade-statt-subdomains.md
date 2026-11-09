# ADR 0007: Eine Domain, ein Pfad je App — keine Subdomains

Stand 2026-11-09 · angenommen

## Kontext

v1 war auf eine Subdomain je App ausgelegt: `kanban.apps.example.com`,
`crm.apps.example.com`, davor eine Forward-Auth. Das ist gebaut und lokal
nachgewiesen.

Beim Aufsetzen auf eine echte Instanz kam die Frage auf, die der Aufbau nie
beantwortet hat: Die Forward-Auth hing als Middleware an Traefiks
**Entrypoint**, und der steht ausschließlich in der **statischen**
Konfiguration — einer Datei, die Coolify verwaltet und bei Updates neu
schreibt. Wir haben den wichtigsten Schutz des Systems in eine Datei gehängt,
die ein fremdes Programm jederzeit überschreiben darf. Startup-Check und
Prüfskript schlagen dann Alarm; das ist Schadensbegrenzung, keine Lösung.

Drei Schnitte standen zur Wahl: eine Codebasis mit Modulen darin, mehrere Apps
unter einer Domain, oder mehrere Apps mit eigenen Subdomains (das Gebaute).

## Entscheidung

**Mehrere Apps, eine Domain, ein Pfad je App.** Jede App bleibt ein eigenes
Deploy mit eigenem Schema und eigener DB-Rolle; erreichbar wird sie unter
`https://intern.example.com/<app>` statt unter einer eigenen Subdomain.

Damit wird ein Weg möglich, den Subdomains nicht hatten: Weil es nur **einen**
Host gibt, können wir die Router für die App-Pfade in unserer **eigenen
dynamischen** Konfiguration definieren, statt sie aus Docker-Labels entstehen
zu lassen. Jeder Router trägt die Forward-Auth selbst. Dann brauchen wir
weder die Entrypoint-Middleware noch Coolifys statische Datei — der Grund für
das Unbehagen verschwindet, statt überwacht zu werden.

Ob Coolify ein solches Verzeichnis anbietet, das ein Update überlebt, ist zu
belegen. Trägt es nicht, bleibt der eigene Reverse-Proxy vor Coolify als
Rückfallweg; die Entrypoint-Middleware ist es nicht mehr.

## Folgen

**Was bleibt:** Schema und DB-Rolle pro App, Freigaben zwischen Apps,
unabhängiges Deployen und Rollback, das Review-Gate, der Agent-Zugang über
MCP, der Katalog-Gedanke. DoD 1 und 3 bis 7 sind unberührt.

**Was einfacher wird:** Kein Wildcard-DNS, ein Zertifikat statt vieler,
kein Catch-all für unbekannte Hosts als tragende Schicht.

**Was wir dafür aufgeben, und das ist der eigentliche Preis:** Ein Cookie gilt
für die ganze Domain. Die Apps sind im Browser nicht mehr getrennt — eine App
kann die Cookies einer anderen lesen. Bei Subdomains ging das nicht. Prozess-
und Datenbanktrennung bleiben; die Browsertrennung fällt weg. Für ein
internes Team mit selbst gebauten Apps ist das tragbar, für fremde Apps aus
einem öffentlichen Katalog wäre es das nicht — das gehört in die Entscheidung
über den Katalog, nicht hierher.

**Was Arbeit macht:** Jede App braucht einen `basePath`, sonst zeigen ihre
Verweise und Dateien ins Leere. Das Starter-Template setzt ihn, und das
Review-Gate prüft ihn — eine App ohne passenden `basePath` ist kaputt, sobald
sie das erste Bild lädt.

**Was an der Signatur hängt:** Das Material aus ADR 0004 bindet Host und
App-Id. Der Host ist jetzt für alle Apps derselbe und trägt nichts mehr bei.
Die Trennung macht weiter die App-Id zusammen mit dem je App abgeleiteten
Secret — eine Signatur für App A passt in App B nicht. Der Host bleibt im
Material, weil er nichts kostet und beim Wechsel der Domain sofort auffällt.

**DoD 2 ändert seinen Wortlaut**, nicht seinen Sinn: „Jede App liegt hinter dem
gemeinsamen Login" wird über Pfade statt über Domains geprüft. Das Testskript
ruft dieselben Apps unter anderen Adressen auf.

## Alternativen

- **Eine Codebasis mit Modulen darin.** Verworfen, obwohl am einfachsten: Alle
  Module liefen in einem Prozess an einer Datenbankverbindung, ein Modul
  könnte alles lesen. DoD 3 gäbe es dann nicht mehr — nicht „noch nicht",
  sondern gar nicht. Der Brief nennt als Risiko ausdrücklich, dass mit KI
  gebaute Apps Konventionen umgehen; genau dagegen ist die Trennung gebaut.
  Außerdem nimmt ein Fehler in einem Modul alle anderen mit.
- **Subdomains behalten** (das Gebaute). Verworfen wegen der statischen
  Konfiguration: Der Schutz hängt an einer Datei, die uns nicht gehört.
- **Eigener Reverse-Proxy vor Coolify.** Nicht verworfen, nur verschoben: Er
  bleibt der Rückfallweg, falls Coolify keine eigene dynamische Konfiguration
  zulässt. Er kostet TLS, ACME und einen Sprung mehr — Aufwand, den man erst
  zahlt, wenn er nötig ist.
