/**
 * Freigaben, die der lokale Aufbau erteilt (`lokal-einrichten.ts`,
 * ADR 0020). Eigene Datei, damit sie ohne den Start des Skripts pruefbar ist.
 */

import type { AppManifest } from '@openapps/app-manifest';
import {
  ConflictError,
  grant,
  NotFoundError,
  resourceRefOf,
  type Actor,
  type DomainContext,
} from '../domain';

export type SelfGrantOutcome = 'granted' | 'already granted' | 'skipped';

/**
 * Erteilt die Antraege `subjectKind: app` einer App **fuer sich selbst**
 * (`subjectId` = eigener Name). Eine App bekommt so nur Rechte, die sie offen
 * im Manifest nennt; Antraege fuer Gruppen, Menschen, Agents oder eine andere
 * App bleiben Antraege. Schon erteilte Freigaben bleiben, wie sie sind. Nur
 * lokal: Auf dem Server erteilt sie ein Mensch oder Agent mit `grant`.
 */
export async function grantSelfRequests(
  ctx: DomainContext,
  operator: Actor,
  manifests: readonly AppManifest[],
  log: (line: string) => void = (line) => console.log(line),
): Promise<ReadonlyArray<{ readonly label: string; readonly outcome: SelfGrantOutcome }>> {
  const results: { label: string; outcome: SelfGrantOutcome }[] = [];
  for (const manifest of manifests) {
    for (const request of manifest.requestedGrants) {
      if (request.subjectKind !== 'app' || request.subjectId !== manifest.name) continue;
      const resource = resourceRefOf(request.resource);
      const label = `app:${manifest.name} ${request.verb} ${resource.kind}:${resource.id}`;
      let outcome: SelfGrantOutcome;
      try {
        await grant(ctx, {
          actor: operator,
          subject: { kind: 'app', id: manifest.name },
          verb: request.verb,
          resource,
        });
        outcome = 'granted';
      } catch (error) {
        if (error instanceof ConflictError) outcome = 'already granted';
        else if (error instanceof NotFoundError) outcome = 'skipped';
        else throw error;
      }
      log(`Grant ${label}: ${outcome}`);
      results.push({ label, outcome });
    }
  }
  return results;
}
