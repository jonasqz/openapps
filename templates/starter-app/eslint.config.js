/**
 * Der UI-Linter der Plattform. Dieselben Regeln laufen im Review-Gate
 * (`request_deploy`) — was hier rot ist, blockiert dort den Deploy.
 *
 * Zusätzlich erlaubte Nicht-UI-Pakete trägt die Control Plane in
 * `allowed-packages.json` ein. Fehlt die Datei, gilt nur die eingebaute
 * Allowlist. Füge keine UI-Bibliothek hinzu: dafür ist `@openapps/ui` da.
 */
import openappsUi from '@openapps/ui/eslint-config';

export default [...openappsUi];
