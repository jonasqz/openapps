/**
 * Verweise im Prozess (ADR 0023) — fuer die Tests der Domaene. Dieselbe
 * Semantik wie `src/infra/pg/refs.ts`: Stand je Quelle, aelterer Stand
 * aendert nichts, leere Menge loescht die Ziele und behaelt den Stand.
 */

import type { IncomingRef, RefRepository, StoredRefTarget } from '../../domain/ports';

interface MemorySource {
  app: string;
  updatedAt: Date;
  targets: StoredRefTarget[];
}

export interface MemoryRefRepository extends RefRepository {
  /** Alle Quellen, fuer Tests. */
  readonly sources: ReadonlyMap<string, Readonly<MemorySource>>;
}

export function createMemoryRefRepository(): MemoryRefRepository {
  const sources = new Map<string, MemorySource>();
  return {
    get sources() {
      return sources;
    },
    async replace(input) {
      const current = sources.get(input.source);
      if (current !== undefined && current.updatedAt.getTime() > input.updatedAt.getTime()) {
        return { status: 'stale' };
      }
      const previous = current?.targets ?? [];
      sources.set(input.source, {
        app: input.app,
        updatedAt: input.updatedAt,
        targets: input.targets.map((target) => ({ ...target })),
      });
      return { status: 'applied', previous };
    },
    async listIncoming(target, limit) {
      const incoming: IncomingRef[] = [];
      for (const [source, entry] of sources) {
        const hit = entry.targets.find((t) => t.ref === target);
        if (hit === undefined) continue;
        incoming.push({ source, sourceApp: entry.app, kind: hit.kind, updatedAt: entry.updatedAt });
      }
      return incoming
        .sort(
          (a, b) =>
            b.updatedAt.getTime() - a.updatedAt.getTime() || a.source.localeCompare(b.source),
        )
        .slice(0, limit);
    },
    async listOutgoing(source) {
      return sources.get(source)?.targets ?? [];
    },
  };
}
