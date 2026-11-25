/**
 * Namen, die die Control Plane vergibt — nicht die App. Schema-, Rollenname
 * und der Pfad der App werden aus dem App-Namen abgeleitet und nie
 * uebernommen, damit eine App sich nicht in ein fremdes Schema schreiben und
 * nicht auf einen fremden Pfad legen kann.
 */

import { ValidationError } from './errors';

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export function assertAppName(name: string): void {
  if (!APP_NAME.test(name)) {
    throw new ValidationError(
      `invalid app name "${name}": lower case letters, digits and hyphens, 3 to 40 characters`,
    );
  }
}

export function schemaNameFor(appName: string): string {
  assertAppName(appName);
  return `app_${appName.replaceAll('-', '_')}`;
}

export function dbRoleFor(appName: string): string {
  return schemaNameFor(appName);
}

/**
 * Der Pfad, unter dem eine App erreichbar ist (ADR 0007): `/<app-name>`.
 *
 * Es gibt kein eigenes Feld dafuer. Der Name der App bestimmt den Pfad, so wie
 * er Schema und Rolle bestimmt — ein zweites Feld koennte vom Namen
 * auseinanderlaufen, und ein Pfad, der nicht zum `basePath` der App passt,
 * macht sie kaputt, sobald sie das erste Bild laedt.
 *
 * Fuehrender Schraegstrich, kein abschliessender: genau die Form, die Next.js
 * als `basePath` erwartet und die Traefik als `PathPrefix` nimmt.
 */
export function appPathFor(appName: string): string {
  assertAppName(appName);
  return `/${appName}`;
}

/**
 * Der Netz-Alias, unter dem das Gateway den Container dieser App erreicht
 * (ADR 0008).
 *
 * Warum nicht der Containername: Coolifys Default ist `<uuid>-<Zeitstempel>`,
 * und der aendert sich bei **jedem** Deploy (`docker.php:670-686`). Ein
 * Dienst, der darauf zeigt, zeigt nach dem naechsten Deploy ins Leere. Also
 * leiten wir den Alias selbst ab — aus dem App-Namen, wie Schema, Rolle und
 * Pfad — und setzen ihn als `custom_network_aliases` am Deploy-Backend.
 *
 * Form: ein einzelnes DNS-Label, kein Punkt. Das Praefix trennt ihn von
 * Containernamen, die Coolify oder jemand anders vergibt.
 */
export function gatewayAliasFor(appName: string): string {
  assertAppName(appName);
  return `openapps-${appName}`;
}

/**
 * Die eine Domain, unter der alle Apps liegen (ADR 0007). Keine Subdomain je
 * App — die App-Domain **ist** die gemeinsame Domain, getrennt wird ueber den
 * Pfad.
 *
 * Normalisiert wie `gatewayHost` und wie `@openapps/sdk` die Env liest:
 * getrimmt und kleingeschrieben. Sonst passt keine Signatur, sobald jemand die
 * Domain mit einem Grossbuchstaben eintraegt.
 */
export function appsDomainFor(appsDomain: string): string {
  const domain = appsDomain.trim().toLowerCase();
  if (domain === '') {
    throw new ValidationError('the shared app domain is empty');
  }
  return domain;
}

/** Die vollstaendige Adresse einer App: `https://<domain>/<app-name>`. */
export function appUrlFor(appName: string, appsDomain: string): string {
  return `https://${appsDomainFor(appsDomain)}${appPathFor(appName)}`;
}

/**
 * Der App-Name aus einem Pfad — die Umkehrung von `appPathFor`.
 *
 * Die Forward-Auth braucht sie: Unter ADR 0007 tragen alle Apps denselben
 * Host, also sagt der Host nicht mehr, worueber entschieden wird. Das erste
 * Pfadsegment sagt es. `null` heisst „kein App-Pfad" — und das ist kein
 * „offen", sondern ein „nein" beim Aufrufer.
 */
export function appNameFromPath(path: string): string | null {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? '';
  const first = withoutQuery.split('/').filter((segment) => segment !== '')[0];
  if (first === undefined) return null;
  return APP_NAME.test(first) ? first : null;
}

/**
 * Ressourcen-Id einer Tabelle, einer View oder eines Tools: `<app-name>.<objekt>`.
 *
 * Getrennt wird am **ersten** Punkt: App-Namen enthalten keinen
 * (`assertAppName`). Tabellen und Views heissen ohne Punkt; Tools duerfen
 * einen tragen (`crm.contacts.list` ist das Tool `contacts.list` der App
 * `crm`) — das Manifest erlaubt das, und die Standard-Apps machen es so.
 * Vorher wurde jede Id mit mehr als einem Punkt abgewiesen, und damit liess
 * sich keines dieser Tools freigeben (ADR 0011).
 */
export function parseObjectResourceId(
  resourceId: string,
  options: { allowDotInObject?: boolean } = {},
): { appName: string; objectName: string } {
  const separator = resourceId.indexOf('.');
  const appName = separator === -1 ? '' : resourceId.slice(0, separator);
  const objectName = separator === -1 ? '' : resourceId.slice(separator + 1);
  const objectPattern = options.allowDotInObject === true ? OBJECT_WITH_DOTS : OBJECT_PLAIN;
  if (!APP_SEGMENT.test(appName) || !objectPattern.test(objectName)) {
    throw new ValidationError(`invalid resource id "${resourceId}": expected <app-name>.<object>`);
  }
  return { appName, objectName };
}

const APP_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const OBJECT_PLAIN = /^[a-z0-9_]+$/;
const OBJECT_WITH_DOTS = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

/** Ressourcen-Id eines Tools: `<app-name>.<tool>`, das Tool darf Punkte tragen. */
export function parseToolResourceId(resourceId: string): { appName: string; toolName: string } {
  const { appName, objectName } = parseObjectResourceId(resourceId, { allowDotInObject: true });
  return { appName, toolName: objectName };
}
