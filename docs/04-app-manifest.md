# App-Paket, Katalog und Onboarding

Jede App ist in v1 schon ein installierbares Paket. Damit kann später ein
Online-Katalog für die Community dazukommen, ohne dass sich Apps oder Control
Plane ändern.

- **App-Manifest** (`app.json` im Repo): Name, Beschreibung, Kategorie, Version,
  benötigte Tabellen, angebotene MCP-Tools, gewünschte Rechte, Quelle (Git-URL
  und Tag).
- **Katalog-Quelle als Abstraktion:** Die Control Plane liest Apps aus einer
  oder mehreren Quellen. In v1 gibt es nur die lokale Quelle (eure eigenen
  Repos). Später kommen ein öffentlicher Community-Katalog und private Kataloge
  (z. B. von Partnern) als weitere Quellen dazu.
- **Installieren = derselbe Weg wie Deployen:** Auch eine App aus dem Katalog
  läuft durch Review-Gate, bekommt Schema und Rolle und erscheint erst nach
  Freigabe.
- **Onboarding (später):** Beim Einrichten wählt eine Firma passende Apps aus
  dem Katalog (z. B. Kanban, CRM, Projektliste) und installiert sie mit einem
  Klick. Danach kann sie jede App anpassen, als eigene Kopie.

In v1 drin: Manifest-Format und Quellen-Abstraktion. Nicht in v1: der
öffentliche Katalog, die Oberfläche zum Stöbern und der Onboarding-Flow.

Das maßgebliche Schema liegt als Code in
[`packages/app-manifest`](../packages/app-manifest). Diese Datei beschreibt die
Absicht, das Paket beschreibt die Form.
