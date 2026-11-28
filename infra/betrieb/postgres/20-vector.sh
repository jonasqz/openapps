#!/bin/sh
# Laeuft genau einmal, beim ersten Start mit leerem Volume, nach 10-owner.sh
# (ADR 0025). Legt pgvector im Schema `extensions` der Datenbank `openapps`
# an. Fuer ein bestehendes Volume ruft man denselben Schritt von Hand auf
# (`openapps-vector`, siehe infra/betrieb/README.md); lokal erledigt das
# infra/lokal/apps-ausrollen.sh.
set -eu
OPENAPPS_DATABASE=openapps /usr/local/bin/openapps-vector
