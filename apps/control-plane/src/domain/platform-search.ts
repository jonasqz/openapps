/**
 * Die Suche ueber alle Apps (ADR 0021): eine foederierte Suche. Die Control
 * Plane fragt die Such-Tools der Apps parallel ab und fuegt die Treffer nach
 * App zusammen. Es gibt keinen zentralen Index und keine Kopie von Rechten:
 * Jede App sucht in ihren eigenen Daten, mit der Identitaet des Aufrufers.
 *
 * ## Wer welche App gefragt bekommt
 *
 * Die Rechteregel steht hier und nirgends sonst (CLAUDE.md 4):
 *
 * - **Mensch:** `read` auf die App, dieselbe Pruefung wie die Forward-Auth
 *   (`canAccessApp`). Wer die App oeffnen darf, darf in ihr suchen; die App
 *   bekommt dieselbe signierte Identitaet wie beim Oeffnen.
 * - **Agent:** `read` auf die App **und** `execute` auf ihr Such-Tool. Ohne
 *   die zweite Freigabe kaeme ein Agent ueber die Suche an ein Tool, das ihm
 *   niemand freigegeben hat; ohne die erste an Inhalte einer App, die er nicht
 *   lesen darf (wie in Knowledge seit ADR 0020).
 * - **App, Gruppe:** nie. Die Suche ist fuer Menschen und Agents.
 *
 * Default-Deny: Ohne Freigabe wird eine App nicht einmal gefragt. Sie taucht
 * dann auch nicht als `failed` auf; wer sie nicht lesen darf, erfaehrt nicht,
 * dass es sie gibt. Innerhalb der App filtert die App wie bisher ueber ihre
 * DB-Rolle und den signierten Kontext.
 *
 * ## Was eine langsame oder kaputte App anrichtet
 *
 * Nichts ausser sich selbst: Frist je App (Default 2 s), danach fehlt sie im
 * Ergebnis und steht unter `failed`. Ein Fehler, eine falsche Antwort, ein
 * Abbruch: dasselbe. Die Suche selbst scheitert nur an falscher Eingabe oder
 * einem Aufrufer, der gar nicht suchen darf.
 */

import { normalizeSearchResult, SEARCH_QUERY_MAX_LENGTH, type SearchHit } from '@openapps/sdk';
import type { AppToolInvoker, HumanIdentity } from './app-tools';
import { canAccessApp } from './apps';
import { audited } from './audit';
import { can } from './can';
import type { DomainContext } from './context';
import { PermissionDeniedError, ValidationError } from './errors';
import { gatewayHost } from './gateway-identity';
import { appPathFor } from './naming';
import { readableAppsFor, wantsReadableApps } from './readable-apps';
import type { Actor, App } from './types';

/**
 * Reservierter Pfad-Praefix der Plattform auf dem Host der Apps. App-Namen
 * beginnen nie mit `_` (`assertAppName`), also kann keine App ihn belegen.
 */
export const PLATFORM_PATH_PREFIX = '/_platform/';

/** Die Suche ueber alle Apps auf dem Host der Apps, fuer die Leiste im Browser. */
export const PLATFORM_SEARCH_PATH = '/_platform/search';

/**
 * Die Pfade unter `PLATFORM_PATH_PREFIX`, die die Forward-Auth durchlaesst,
 * und zwar genau diese, ohne Praefix-Vergleich. Alles andere dort: 403.
 */
export const PLATFORM_PATHS: readonly string[] = Object.freeze([PLATFORM_SEARCH_PATH]);

export const PLATFORM_SEARCH_LIMITS = Object.freeze({
  /** Kuerzere Suchtexte fragen keine App: Ein Zeichen trifft fast alles. */
  queryMin: 2,
  queryMax: SEARCH_QUERY_MAX_LENGTH,
  /** Treffer je App ohne Angabe. */
  perAppDefault: 5,
  /** Hoechstens so viele Treffer je App. */
  perAppMax: 10,
  /** Frist je App in Millisekunden. */
  timeoutMs: 2000,
  /** Hoechstens so viele App-Namen im Filter `apps`. */
  appsFilterMax: 50,
});

export interface PlatformSearchHit {
  readonly id: string;
  readonly title: string;
  readonly snippet?: string;
  readonly kind?: string;
  /** Pfad in der App, wie die App ihn geliefert hat. */
  readonly url: string;
  /** Volle Adresse zum Oeffnen: Adresse der App plus `url`. */
  readonly href: string;
}

export interface PlatformSearchAppResult {
  readonly app: string;
  readonly title: string;
  readonly hits: readonly PlatformSearchHit[];
}

export type PlatformSearchFailureReason = 'timeout' | 'error' | 'invalid_response';

export interface PlatformSearchFailure {
  readonly app: string;
  readonly title: string;
  readonly reason: PlatformSearchFailureReason;
}

export interface PlatformSearchResult {
  readonly query: string;
  /** Apps mit mindestens einem Treffer, in der Reihenfolge der Leiste (Name). */
  readonly results: readonly PlatformSearchAppResult[];
  /** Apps, die gefragt wurden, aber nicht rechtzeitig oder nicht brauchbar antworteten. */
  readonly failed: readonly PlatformSearchFailure[];
  /** Apps, die geantwortet haben, auch ohne Treffer. */
  readonly searched: readonly string[];
}

/** Eine App, die gefragt wird, mit ihrem Such-Tool und ihrer Adresse. */
export interface SearchTarget {
  readonly app: App;
  readonly tool: string;
  /** Adresse der App ohne abschliessenden Schraegstrich, z. B. `https://apps.example.com/crm`. */
  readonly baseHref: string;
}

/**
 * Das Such-Tool der App, wenn sie an der Suche teilnimmt: im Manifest
 * benannt und dort auch angeboten. Das Schema prueft das schon; hier noch
 * einmal, weil eine alte Zeile im Register ein aelteres Manifest tragen kann.
 */
export function searchToolOf(app: Pick<App, 'manifest'>): string | null {
  const tool = app.manifest.search?.tool;
  if (tool === undefined) return null;
  const offered = app.manifest.offeredTools.find((entry) => entry.name === tool);
  return offered !== undefined && offered.verb === 'read' ? tool : null;
}

/** Nimmt die App an der Suche teil? Nicht archiviert, deployt, mit Such-Tool. */
export function isSearchable(app: Pick<App, 'archivedAt' | 'primaryDomain' | 'manifest'>): boolean {
  return app.archivedAt === null && app.primaryDomain !== null && searchToolOf(app) !== null;
}

/** Adresse der App wie in der Leiste (`navigation.ts`): `https://<domain>/<app>`. */
export function gatewayAppHref(app: Pick<App, 'name' | 'primaryDomain'>): string | null {
  if (app.primaryDomain === null) return null;
  return `https://${gatewayHost(app.primaryDomain)}${appPathFor(app.name)}`;
}

class SearchTimeout extends Error {}

/**
 * Der Kern ohne Rechte: fragt jedes Ziel parallel mit Frist und sammelt
 * Treffer und Ausfaelle. Fuer `searchApps` und den lokalen Ansehen-Proxy
 * (ADR 0013), der dieselbe Foederation fuer den Betrachter braucht. Wirft
 * nie wegen eines Ziels.
 */
export async function federateSearch(input: {
  readonly targets: readonly SearchTarget[];
  readonly query: string;
  readonly limit: number;
  readonly timeoutMs: number;
  readonly call: (
    target: SearchTarget,
    args: { readonly query: string; readonly limit: number },
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Fuer Fehler einer App. Default: `console.error` ohne Einzelheiten der Antwort. */
  readonly onError?: (app: string, error: unknown) => void;
}): Promise<Omit<PlatformSearchResult, 'query'>> {
  const onError =
    input.onError ??
    ((app: string, error: unknown) => {
      console.error(
        `[search] ${app}:`,
        error instanceof Error ? error.message.slice(0, 200) : 'failed',
      );
    });
  const ordered = [...input.targets].sort((a, b) => a.app.name.localeCompare(b.app.name));

  const outcomes = await Promise.all(
    ordered.map(async (target) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SearchTimeout());
        }, input.timeoutMs);
      });
      try {
        const value = await Promise.race([
          input.call(target, { query: input.query, limit: input.limit }, controller.signal),
          deadline,
        ]);
        const hits = normalizeSearchResult(value, input.limit);
        if (hits === null) {
          return { target, failed: 'invalid_response' as const };
        }
        return { target, hits };
      } catch (error) {
        if (error instanceof SearchTimeout) return { target, failed: 'timeout' as const };
        onError(target.app.name, error);
        return { target, failed: 'error' as const };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        // Laeuft der Aufruf noch (Fehler vor der Frist), nicht weiter warten.
        controller.abort();
      }
    }),
  );

  const results: PlatformSearchAppResult[] = [];
  const failed: PlatformSearchFailure[] = [];
  const searched: string[] = [];
  for (const outcome of outcomes) {
    const { app, baseHref } = outcome.target;
    if ('failed' in outcome) {
      failed.push({ app: app.name, title: app.displayName, reason: outcome.failed });
      continue;
    }
    searched.push(app.name);
    if (outcome.hits.length === 0) continue;
    results.push({
      app: app.name,
      title: app.displayName,
      hits: outcome.hits.map((hit: SearchHit) => ({ ...hit, href: `${baseHref}${hit.url}` })),
    });
  }
  return { results, failed, searched };
}

export interface SearchAppsInput {
  readonly actor: Actor;
  /** Pflicht fuer einen Menschen: seine Identitaet aus der Session. */
  readonly humanIdentity?: HumanIdentity;
  readonly query: string;
  /** Nur diese Apps (Namen). Unbekannte und nicht lesbare fallen still weg. */
  readonly apps?: readonly string[];
  /** Treffer je App, 1 bis 10, Default 5. */
  readonly limit?: number;
  readonly invoker: AppToolInvoker;
  /** Frist je App in Millisekunden. Default 2000. Fuer Tests kleiner. */
  readonly timeoutMs?: number;
  readonly correlationId?: string;
  /**
   * Adresse einer App fuer die Links der Treffer. Default wie die Leiste
   * (`gatewayAppHref`); lokal zeigt die Verwaltung auf den Ansehen-Proxy.
   */
  readonly appHref?: (app: App) => string | null;
}

/** Suchtext, Grenze und Filter, geprueft. Wirft `ValidationError`. */
export function parseSearchRequest(input: {
  readonly query: unknown;
  readonly limit?: unknown;
  readonly apps?: unknown;
}): { query: string; limit: number; apps: readonly string[] | undefined } {
  if (typeof input.query !== 'string') throw new ValidationError('query must be a string');
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (query.length < PLATFORM_SEARCH_LIMITS.queryMin) {
    throw new ValidationError(
      `query must have at least ${String(PLATFORM_SEARCH_LIMITS.queryMin)} characters`,
    );
  }
  if (query.length > PLATFORM_SEARCH_LIMITS.queryMax) {
    throw new ValidationError(
      `query must have at most ${String(PLATFORM_SEARCH_LIMITS.queryMax)} characters`,
    );
  }

  const limit = input.limit ?? PLATFORM_SEARCH_LIMITS.perAppDefault;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > PLATFORM_SEARCH_LIMITS.perAppMax
  ) {
    throw new ValidationError(
      `limit must be a whole number from 1 to ${String(PLATFORM_SEARCH_LIMITS.perAppMax)}`,
    );
  }

  let apps: readonly string[] | undefined;
  if (input.apps !== undefined) {
    if (
      !Array.isArray(input.apps) ||
      input.apps.length > PLATFORM_SEARCH_LIMITS.appsFilterMax ||
      !input.apps.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 64)
    ) {
      throw new ValidationError(
        `apps must be a list of at most ${String(PLATFORM_SEARCH_LIMITS.appsFilterMax)} app names`,
      );
    }
    apps = input.apps as string[];
  }
  return { query, limit, apps };
}

/**
 * Darf dieser Aufrufer in dieser App suchen? Siehe Dateikopf. Eine Stelle,
 * damit Leiste, REST-Route und MCP-Tool dieselbe Antwort bekommen.
 */
export async function maySearchApp(
  ctx: DomainContext,
  actor: Actor,
  app: Pick<App, 'id' | 'name'>,
  tool: string,
): Promise<boolean> {
  if (actor.kind !== 'user' && actor.kind !== 'agent') return false;
  if (!(await canAccessApp(ctx, actor, 'read', app))) return false;
  if (actor.kind === 'user') return true;
  return can(ctx, actor, 'execute', { kind: 'tool', id: `${app.name}.${tool}` });
}

/**
 * Sucht in allen Apps, die der Aufrufer durchsuchen darf. Genau ein
 * Audit-Eintrag `search` je Aufruf, auch abgelehnt oder fehlerhaft. Der
 * Suchtext steht **nicht** im Log, nur seine Laenge: Suchtexte enthalten
 * Namen und Kundendaten, das Log ist fuer alle Administratoren lesbar.
 */
export async function searchApps(
  ctx: DomainContext,
  input: SearchAppsInput,
): Promise<PlatformSearchResult> {
  const queryLength = typeof input.query === 'string' ? input.query.trim().length : 0;
  return audited(
    ctx,
    {
      actor: input.actor,
      action: 'search',
      resource: { kind: 'app', id: '*' },
      detail: { queryLength },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    },
    async () => {
      const { actor } = input;
      if (actor.kind !== 'user' && actor.kind !== 'agent') {
        throw new PermissionDeniedError(
          `${actor.kind}:${actor.id} may not search: the platform search is for people and agents`,
        );
      }
      if (
        actor.kind === 'user' &&
        (input.humanIdentity === undefined || input.humanIdentity.userId !== actor.id)
      ) {
        throw new PermissionDeniedError('a person searches only with their own session');
      }

      const {
        query,
        limit,
        apps: only,
      } = parseSearchRequest({
        query: input.query,
        limit: input.limit,
        apps: input.apps,
      });

      const candidates = (await ctx.apps.listAll()).filter(
        (app) => isSearchable(app) && (only === undefined || only.includes(app.name)),
      );
      const allowed = await Promise.all(
        candidates.map(async (app) => {
          const tool = searchToolOf(app);
          const baseHref = (input.appHref ?? gatewayAppHref)(app);
          if (tool === null || baseHref === null) return null;
          return (await maySearchApp(ctx, actor, app, tool)) ? { app, tool, baseHref } : null;
        }),
      );
      const targets = allowed.filter((target): target is SearchTarget => target !== null);

      // Die lesbaren Apps (ADR 0020) nur einmal und nur, wenn ein Ziel sie
      // anfordert. Scheitert die Berechnung: `null`, die App zeigt weniger.
      let readable: Promise<readonly string[] | null> | undefined;
      const readableFor = (app: App): Promise<readonly string[] | null> => {
        if (!wantsReadableApps(app)) return Promise.resolve(null);
        readable ??= readableAppsFor(ctx, actor).catch(() => null);
        return readable;
      };

      const outcome = await federateSearch({
        targets,
        query,
        limit,
        timeoutMs: input.timeoutMs ?? PLATFORM_SEARCH_LIMITS.timeoutMs,
        call: async (target, args, signal) =>
          input.invoker.invoke({
            app: target.app,
            toolName: target.tool,
            actor,
            args,
            readableApps: await readableFor(target.app),
            ...(input.humanIdentity === undefined ? {} : { humanIdentity: input.humanIdentity }),
            signal,
          }),
      });

      return {
        value: { query, ...outcome },
        detail: {
          searched: outcome.searched,
          failed: outcome.failed.map((entry) => `${entry.app}:${entry.reason}`),
          hits: outcome.results.reduce((sum, group) => sum + group.hits.length, 0),
        },
      };
    },
  );
}
