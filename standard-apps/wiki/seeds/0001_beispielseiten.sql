-- Beispielseiten einer fiktiven Firma, damit ein frisches Wiki nicht leer ist
-- und Menschen wie Agents sofort sehen, wie Seiten, Unterseiten und Tags
-- aussehen. Feste IDs, damit Unterseiten auf ihre Eltern zeigen koennen.
-- Keine echten Zugangsdaten, keine echten Personen.

insert into pages (id, parent_id, title, content_md, tags, created_by, updated_by) values
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  null,
  'Nordlicht Handbuch',
  $md$# Willkommen bei der Nordlicht GmbH

Dieses Handbuch sammelt alles, was du für den Alltag bei **Nordlicht** brauchst.
Es wird von Menschen und von Agents gepflegt. Jede Änderung steht im *Verlauf*.

## Wo fange ich an?

- Neu im Team? Lies zuerst das **Onboarding**.
- Urlaub planen? Siehe **Urlaubsregel**.
- Zugang zu einem Werkzeug fehlt? Siehe **Tools & Zugänge**.

Fehlt etwas, lege eine Unterseite an oder ergänze die passende Seite.
$md$,
  array['handbuch', 'start'],
  'system:beispieldaten',
  'system:beispieldaten'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Onboarding',
  $md$# Deine erste Woche

Schön, dass du da bist. Diese Liste führt dich durch die ersten Tage.

## Tag 1

1. Laptop abholen und einrichten
2. Im Passwort-Manager anmelden
3. Vorstellungsrunde im Team-Kanal

## Bis Ende der Woche

- Ein Gespräch mit deiner **Patin** oder deinem **Paten**
- Die Seite *Tools & Zugänge* durchgehen
- Eine erste kleine Aufgabe aus dem Board übernehmen

> Fragen sind ausdrücklich erwünscht. Niemand erwartet, dass du in der ersten Woche alles weißt.

Mehr über das Unternehmen: [nordlicht.example](https://nordlicht.example)
$md$,
  array['onboarding', 'personal'],
  'system:beispieldaten',
  'system:beispieldaten'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Urlaubsregel',
  $md$# Urlaub bei Nordlicht

Alle Vollzeitkräfte haben **30 Urlaubstage** im Kalenderjahr. Teilzeit anteilig.

## So beantragst du Urlaub

1. Mit dem Team abstimmen, wer dich vertritt
2. Antrag im Personalsystem stellen, mindestens **zwei Wochen** vorher
3. Abwesenheit in den Teamkalender eintragen

## Regeln

- Zwischen dem 22. Dezember und dem 1. Januar ist das Büro geschlossen. Diese Tage zählen als Urlaub.
- Resturlaub verfällt am *31. März* des Folgejahres.
- Mehr als drei Wochen am Stück bitte früh mit der Teamleitung klären.
$md$,
  array['personal', 'urlaub'],
  'system:beispieldaten',
  'system:beispieldaten'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000004',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Tools & Zugänge',
  $md$# Werkzeuge im Alltag

Hier steht, **welche** Werkzeuge wir nutzen und **wie** du Zugang bekommst.
Zugangsdaten stehen nie in diesem Wiki und gehen nie per Mail herum.

## Werkzeuge

- **Chat**: Team-Kanäle für den Alltag
- **Board**: Aufgaben und Projekte
- **Passwort-Manager**: alle geteilten Zugänge
- **openapps**: interne Apps, auch dieses Wiki

## Zugang beantragen

1. Anfrage im Kanal `#it-hilfe` stellen
2. Die IT gibt den Zugang im Passwort-Manager frei
3. Fertig, kein Passwort im Klartext

Wer einen Zugang nicht mehr braucht, meldet das ebenfalls in `#it-hilfe`.
$md$,
  array['it', 'zugang'],
  'system:beispieldaten',
  'system:beispieldaten'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000005',
  null,
  'Meeting-Notizen',
  $md$# Wochenrunde

Notizen aus der Wochenrunde. Neue Runden werden unten **angehängt**,
damit der Verlauf an einer Stelle bleibt.

## Runde vom 16. November

- Quartalsziele: zwei von drei auf Kurs
- Neues Wiki eingeführt, Feedback bis Freitag in `#wiki`
- *Offen:* Wer übernimmt die Planung der Weihnachtsfeier?

## Runde vom 23. November

- Weihnachtsfeier: Team Vertrieb plant
- Onboarding-Seite überarbeitet
$md$,
  array['meeting', 'notizen'],
  'system:beispieldaten',
  'system:beispieldaten'
);

-- Auch die Beispielseiten haben einen ersten Eintrag im Verlauf.
insert into page_revisions (page_id, change, title, content_md, tags, edited_by, edited_at)
select id, 'create', title, content_md, tags, created_by, created_at
from pages
where id in (
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000004',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000005'
);
