/**
 * Der Plattform-MCP hat keine eigene Datenbank und keine eigene Logik. Er
 * benutzt denselben `DomainContext` wie die Control Plane — zusammengesteckt in
 * deren `runtime`, damit es nur eine Stelle gibt, die weiss, was dahintersteckt.
 */

import { domainContext } from '@openapps/control-plane/runtime';
import type { DomainContext } from '@openapps/control-plane/domain';

export function platformContext(): DomainContext {
  return domainContext();
}
