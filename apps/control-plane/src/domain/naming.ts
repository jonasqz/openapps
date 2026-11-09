/**
 * Namen, die die Control Plane vergibt — nicht die App. Schema- und
 * Rollenname werden aus dem App-Namen abgeleitet und nie uebernommen, damit
 * eine App sich nicht in ein fremdes Schema schreiben kann.
 */

import { ValidationError } from './errors';

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export function assertAppName(name: string): void {
  if (!APP_NAME.test(name)) {
    throw new ValidationError(
      `ungueltiger App-Name "${name}": Kleinbuchstaben, Ziffern und Bindestrich, 3 bis 40 Zeichen`,
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

export function domainFor(appName: string, baseDomain: string): string {
  assertAppName(appName);
  return `${appName}.${baseDomain}`;
}

/** Ressourcen-Id einer Tabelle oder View: `<app-name>.<objekt>`. */
export function parseObjectResourceId(resourceId: string): { appName: string; objectName: string } {
  const parts = resourceId.split('.');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new ValidationError(
      `ungueltige Ressourcen-Id "${resourceId}": erwartet <app-name>.<objekt>`,
    );
  }
  return { appName: parts[0], objectName: parts[1] };
}

/** Ressourcen-Id eines Tools: `<app-name>.<tool>`. */
export function parseToolResourceId(resourceId: string): { appName: string; toolName: string } {
  const { appName, objectName } = parseObjectResourceId(resourceId);
  return { appName, toolName: objectName };
}
