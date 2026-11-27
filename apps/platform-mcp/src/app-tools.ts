/**
 * Die Weiterleitung der App-Tools.
 *
 * Sichtbarkeit und Aufruf liegen seit ADR 0020 in der Domaene der Control
 * Plane (`domain/app-tools.ts`), weil auch Apps App-Tools aufrufen und beide
 * Wege dieselbe Pruefung brauchen. Diese Datei reicht sie nur weiter, damit
 * der MCP keine zweite Fassung hat.
 *
 * Ein Agent sieht nur die Tools, fuer die er eine Freigabe hat — und wird ohne
 * Freigabe **blockiert**, nicht nur nicht beliefert (DoD 6).
 */

export {
  callAppTool,
  listAppTools,
  type AppToolInvoker,
  type AppToolRef,
} from '@openapps/control-plane/domain';
