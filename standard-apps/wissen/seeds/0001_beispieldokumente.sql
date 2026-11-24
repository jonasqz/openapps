-- Beispieldaten: vier fiktive interne Dokumente der Nordlicht GmbH, damit
-- Suche und Chunking sofort etwas zu tun haben.
--
-- Diese Migration legt NUR die Dokumente an, keine Abschnitte. Zerlegt werden
-- sie beim Start in src/instrumentation.ts (`chunkPendingDocuments`), mit
-- derselben Funktion wie `documents.add`. Begruendung steht dort.
--
-- created_by 'system:beispieldaten' ist keine Nutzer-Id und kann nie mit einer
-- echten Identitaet aus dem Gateway zusammenfallen.

insert into documents (title, source, content, char_count, created_by)
select title, source, content, char_length(content), 'system:beispieldaten'
from (values
(
  'Reisekostenrichtlinie',
  'Nordlicht GmbH, Personalhandbuch Kapitel 4, Stand Januar 2026',
  $doc$Diese Richtlinie regelt, welche Reisekosten die Nordlicht GmbH bei Dienstreisen erstattet. Sie gilt für alle Beschäftigten, Auszubildenden und Praktikanten. Eine Dienstreise ist jede Reise, die aus dienstlichem Anlass angeordnet oder genehmigt wurde. Reisen zu einem anderen Standort der Nordlicht GmbH gelten ebenfalls als Dienstreise.

Genehmigung: Jede Reise muss vor Antritt im Reiseportal beantragt und von der direkten Führungskraft genehmigt werden. Reisen ins Ausland und Reisen mit voraussichtlichen Kosten über 1.500 Euro genehmigt zusätzlich die Bereichsleitung. Ohne Genehmigung werden keine Kosten erstattet.

Verkehrsmittel: Vorrang hat die Bahn. Fahrten bis 4 Stunden Fahrzeit werden in der 2. Klasse gebucht, längere Fahrten dürfen in der 1. Klasse gebucht werden. Inlandsflüge sind nur erlaubt, wenn die Bahnfahrt länger als 6 Stunden dauert. Flüge werden grundsätzlich in der Economy Class gebucht.

Kilometerpauschale: Wer mit dem privaten Pkw fährt, erhält eine Kilometerpauschale von 0,30 Euro je gefahrenem Kilometer. Für Mitfahrende gibt es keinen Zuschlag. Parkgebühren und Mautkosten werden gegen Beleg zusätzlich erstattet. Die Pauschale deckt alle Fahrzeugkosten ab, auch Schäden am eigenen Fahrzeug.

Mietwagen: Ein Mietwagen ist nur zulässig, wenn öffentliche Verkehrsmittel nicht zumutbar sind. Gebucht wird höchstens die Kompaktklasse über den Rahmenvertrag. Eine Zusatzversicherung ist nicht nötig, sie ist im Rahmenvertrag enthalten.

Übernachtung: Die Hotelobergrenze beträgt 120 Euro pro Nacht inklusive Frühstück. In München, Hamburg, Frankfurt am Main und bei Messen gilt eine Obergrenze von 160 Euro pro Nacht. Teurere Hotels sind vorab mit Begründung genehmigen zu lassen. Wird kein Hotel genutzt, zahlen wir eine Übernachtungspauschale von 20 Euro.

Verpflegung: Für Reisen im Inland gelten die steuerlichen Pauschalen. Bei mehr als 8 Stunden Abwesenheit sind das 14 Euro, bei 24 Stunden 28 Euro pro Tag. Ist ein Frühstück im Hotelpreis enthalten, werden 5,60 Euro abgezogen, für ein gestelltes Mittag- oder Abendessen jeweils 11,20 Euro.

Abrechnung: Die Reisekostenabrechnung ist spätestens 4 Wochen nach Ende der Reise im Reiseportal einzureichen. Alle Belege werden als Foto oder PDF hochgeladen, Originale bewahrt man 3 Monate auf. Verspätete Abrechnungen werden nur mit Zustimmung der Bereichsleitung bearbeitet. Die Erstattung erfolgt mit der nächsten Gehaltsabrechnung.

Fragen zur Reisekostenrichtlinie beantwortet die Personalabteilung unter reisen@nordlicht.example.$doc$
),
(
  'Leitfaden Angebotserstellung',
  'Vertriebshandbuch v3, Abschnitt Angebote',
  $doc$Dieser Leitfaden beschreibt, wie der Vertrieb der Nordlicht GmbH Angebote erstellt, kalkuliert und freigibt. Ziel ist, dass jedes Angebot vollständig, nachvollziehbar und innerhalb von 3 Arbeitstagen beim Kunden ist.

Grundlage: Jedes Angebot wird im CRM aus einer Vorlage erzeugt. Freitext-Angebote in Textverarbeitung oder E-Mail sind nicht zulässig, weil sie weder in der Pipeline noch in der Auswertung erscheinen. Die Preise kommen aus der gültigen Preisliste, die das Produktmanagement jedes Quartal veröffentlicht.

Pflichtangaben: Jedes Angebot enthält Ansprechpartner beim Kunden, Leistungsbeschreibung, Mengen, Einzelpreise, Gesamtpreis netto, Zahlungsbedingungen und eine Gültigkeit von 30 Tagen. Abweichende Zahlungsziele über 30 Tage hinaus brauchen die Zustimmung der Buchhaltung.

Rabattgrenzen: Vertriebsmitarbeitende dürfen eigenständig bis zu 10 Prozent Rabatt auf den Listenpreis gewähren. Rabatte von mehr als 10 bis 20 Prozent gibt die Vertriebsleitung frei. Rabatte über 20 Prozent sind nur mit Zustimmung der Geschäftsführung möglich und müssen schriftlich begründet werden, zum Beispiel mit einem strategischen Neukunden oder einem Mehrjahresvertrag. Mengenrabatte aus der Preisliste zählen nicht zu diesen Grenzen.

Freigabe ab einem Betrag: Angebote mit einem Gesamtwert ab 25.000 Euro netto gibt die Vertriebsleitung frei, bevor sie den Kunden erreichen. Ab 100.000 Euro netto ist zusätzlich die Freigabe der Geschäftsführung nötig. Die Freigabe läuft im CRM über den Status „Zur Freigabe“; eine Freigabe per E-Mail oder Chat gilt nicht.

Kalkulation von Dienstleistungen: Beratungstage werden mit dem Tagessatz aus der Preisliste angesetzt, derzeit 1.150 Euro netto. Reisezeiten berechnen wir mit 50 Prozent des Tagessatzes, Reisekosten nach Aufwand gemäß Reisekostenrichtlinie. Festpreise sind nur mit einem Risikoaufschlag von mindestens 15 Prozent erlaubt.

Nachverfolgung: Spätestens 7 Tage nach Versand fragt der Vertrieb beim Kunden nach. Läuft ein Angebot ohne Rückmeldung ab, wird es im CRM als „verloren“ markiert und der Grund eingetragen, damit die Auswertung stimmt.

Ansprechpartner für Fragen zu Preisen und Rabatten ist die Vertriebsleitung.$doc$
),
(
  'IT-Sicherheitsregeln',
  'https://intranet.nordlicht.example/it/sicherheit',
  $doc$Diese Regeln gelten für alle Beschäftigten der Nordlicht GmbH und für externe Mitarbeitende mit Zugang zu unseren Systemen. Sie schützen Kundendaten, Geschäftsgeheimnisse und den laufenden Betrieb. Verstöße können arbeitsrechtliche Folgen haben.

Passwörter: Ein Passwort hat mindestens 14 Zeichen. Es wird für keinen anderen Dienst verwendet und nie weitergegeben, auch nicht an die IT. Wir empfehlen den freigegebenen Passwortmanager. Passwörter müssen nicht regelmäßig gewechselt werden, aber sofort, wenn der Verdacht besteht, dass jemand sie kennt.

Zwei-Faktor-Anmeldung: Für E-Mail, CRM, Buchhaltung und den Fernzugang ist die Zwei-Faktor-Anmeldung Pflicht. Als zweiter Faktor gilt die Authenticator-App auf dem Diensthandy oder ein Hardware-Schlüssel. SMS-Codes sind nicht zulässig.

Geräte: Dienstliche Daten werden nur auf Geräten verarbeitet, die die IT verwaltet. Private Geräte dürfen nur über den Browser auf E-Mail und Kalender zugreifen. Der Bildschirm wird beim Verlassen des Arbeitsplatzes gesperrt, automatisch spätestens nach 5 Minuten. Verlorene oder gestohlene Geräte meldet man sofort, auch nachts und am Wochenende, unter der IT-Notfallnummer.

Phishing: Links und Anhänge in unerwarteten E-Mails öffnet man nicht. Verdächtige Nachrichten leitet man mit dem Knopf „Phishing melden“ an die IT weiter. Die IT fragt nie per E-Mail oder Telefon nach einem Passwort. Wer versehentlich auf einen Link geklickt oder Zugangsdaten eingegeben hat, meldet das sofort; das ist kein Fehler, für den jemand bestraft wird.

Software: Programme installiert nur die IT. Cloud-Dienste und KI-Werkzeuge dürfen nur genutzt werden, wenn sie auf der Liste der freigegebenen Dienste stehen. Kundendaten und interne Dokumente werden nie in nicht freigegebene Dienste kopiert.

Datenablage: Dokumente gehören in die freigegebenen Ablagen, nicht auf lokale Festplatten oder USB-Sticks. Vertrauliche Dokumente werden nur an Personen geteilt, die sie für ihre Arbeit brauchen. Freigabelinks für Externe laufen nach höchstens 30 Tagen ab.

Sicherheitsvorfälle meldet man an sicherheit@nordlicht.example oder telefonisch an die IT-Notfallnummer.$doc$
),
(
  'Produktblatt Nordlicht Lumen',
  'Produktmanagement, Produktblatt Lumen 2026',
  $doc$Nordlicht Lumen ist unsere Plattform zur Steuerung der Beleuchtung in Büro- und Gewerbegebäuden. Sie verbindet Leuchten, Präsenzmelder und Tageslichtsensoren und senkt den Stromverbrauch für Licht nach unseren Messungen in Bestandsgebäuden um 40 bis 60 Prozent.

Zielgruppe: Lumen richtet sich an Eigentümer und Betreiber von Bürogebäuden ab etwa 2.000 Quadratmetern, an Facility-Management-Dienstleister und an Handelsketten mit vielen Filialen. Besonders lohnend ist Lumen, wenn die Beleuchtung lange Laufzeiten hat und bislang manuell geschaltet wird.

Funktionen: Lumen schaltet und dimmt Licht nach Anwesenheit und Tageslicht, folgt Zeitplänen und Kalendern und lässt sich pro Raum, Etage oder Gebäude steuern. Störungen an Leuchten meldet das System automatisch. Ein Energiebericht zeigt den Verbrauch pro Zone und Monat und eignet sich als Nachweis für Energieaudits.

Technik: Die Steuerung läuft lokal auf einem Gateway pro Gebäude und funktioniert auch ohne Internetverbindung weiter. Unterstützt werden DALI-2, KNX und Zigbee. Die Verwaltungsoberfläche läuft im Browser; Daten werden ausschließlich in Rechenzentren in Deutschland gespeichert. Eine offene Schnittstelle (REST) erlaubt die Anbindung an Gebäudeleittechnik.

Pakete und Preise: Lumen Basis kostet 2,50 Euro pro Leuchtpunkt und Monat und enthält Steuerung, Zeitpläne und Störungsmeldungen. Lumen Pro kostet 3,90 Euro pro Leuchtpunkt und Monat und enthält zusätzlich Energieberichte, die Schnittstelle und einen Ansprechpartner im Support. Das Gateway kostet einmalig 690 Euro. Die Mindestlaufzeit beträgt 24 Monate. Die Einrichtung vor Ort wird nach Aufwand mit Beratungstagen berechnet.

Service: Der Support ist werktags von 8 bis 18 Uhr erreichbar. Für Lumen Pro gilt eine Reaktionszeit von 4 Stunden bei Störungen, die ein ganzes Gebäude betreffen. Updates spielen wir ohne Unterbrechung des Betriebs ein.

Abgrenzung: Lumen steuert keine Heizung, Lüftung oder Jalousien. Für diese Gewerke empfehlen wir die Anbindung über die Schnittstelle an die vorhandene Gebäudeleittechnik.$doc$
)
) as seed (title, source, content);
