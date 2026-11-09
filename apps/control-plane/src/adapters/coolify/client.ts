/**
 * Implementierung von `DeploymentBackend` gegen die Coolify-REST-API.
 *
 * Was dieser Adapter seit ADR 0008 **nicht** mehr tut: Er haengt keine
 * Traefik-Labels an die App und gibt ihr keine Domain. Router, Dienst und
 * Middlewares stehen in unserer eigenen dynamischen Konfiguration
 * (`domain/gateway-config.ts`, geschrieben von `infra/gateway-config-store.ts`).
 * Dieser Adapter sorgt nur noch dafuer, dass Coolify der App **keinen** eigenen
 * Weg nach innen gibt — siehe `createApp` und `readAppGatewayFacts`.
 *
 * Sie uebersetzt in beide Richtungen: aus neutralen Begriffen der Domaene
 * werden Coolify-Endpunkte, und aus Coolify-Antworten werden neutrale
 * Ergebnisse. Wenn Coolify nicht traegt, wird genau diese Datei ersetzt
 * (Abbruchpfad aus dem Brief) — und nichts anderes.
 */

import type {
  AppGatewayFactsReading,
  BackendAppSpec,
  BackendDeployRequest,
  BackendDeployResult,
  BackendStatus,
  DeploymentBackend,
} from '../../domain/ports';
import type { CoolifyConfig } from './config';

interface CoolifyApplication {
  readonly uuid?: string;
  readonly status?: string;
  /**
   * Die „custom labels" der App — eine Zeile pro Label, `key=value`. Coolify
   * gibt sie je nach Version base64-kodiert zurueck; `parseCoolifyLabels`
   * nimmt beides.
   */
  readonly custom_labels?: string | null;
  /** Veroeffentlichte Host-Ports. Erwartet: leer (ADR 0008). */
  readonly ports_mappings?: string | null;
  /** Domains, die Coolify der App gegeben hat. Erwartet: keine (ADR 0008). */
  readonly fqdn?: string | null;
  readonly domains?: string | null;
}

interface CoolifyDeployment {
  readonly deployment_uuid?: string;
  readonly message?: string;
}

export function createCoolifyBackend(config: CoolifyConfig): DeploymentBackend {
  async function call<T>(
    path: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Deploy-Backend antwortete ${response.status}: ${text.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async createApp(spec: BackendAppSpec): Promise<{ backendRef: string }> {
      const created = await call<CoolifyApplication>('/applications/public', {
        method: 'POST',
        body: {
          project_uuid: config.projectUuid,
          server_uuid: config.serverUuid,
          environment_name: config.environmentName,
          name: spec.appName,
          git_repository: spec.gitUrl,
          git_branch: spec.gitRef,
          build_pack: 'nixpacks',
          // --- Die vier Zeilen, auf die es nach ADR 0008 ankommt ----------
          //
          // 1. **Keine Domain, und zwar ausdruecklich.** `autogenerate_domain`
          //    ist in Coolifys API default `true`
          //    (`ApplicationsController.php:1690`): Wer `domains` weglaesst,
          //    bekommt trotzdem eine sslip.io-Domain — und mit ihr einen
          //    Router **ohne** unsere Middlewares. Das Weglassen von `domains`
          //    allein reicht also nicht.
          autogenerate_domain: false,
          // 2. Der Netz-Alias, unter dem unser Dienst die App anspricht. Der
          //    Containername taugt dafuer nicht: Default ist
          //    `<uuid>-<Zeitstempel>`, er aendert sich bei jedem Deploy
          //    (`docker.php:670-686`).
          custom_network_aliases: spec.networkAlias,
          // 3. Zweiter Halt: ein stabiler Containername mit demselben Wert.
          //    Dann traegt auch der Containername den Alias, falls
          //    `custom_network_aliases` in einer Coolify-Fassung einmal nicht
          //    greift.
          is_consistent_container_name_enabled: true,
          custom_internal_name: spec.networkAlias,
          // 4. Kein veroeffentlichter Host-Port. Leer heisst: der Container ist
          //    nur im Docker-Netz erreichbar
          //    (`ApplicationDeploymentJob.php:4785`, `:4902-4903`). Ein Wert
          //    hier macht die App am Gateway vorbei erreichbar und das
          //    Signatur-Modell aus Spec 3.2 wertlos.
          ports_mappings: '',
          // Der Port, auf dem die App lauscht — fuer Coolifys Healthcheck und
          // sein `EXPOSE`. Unser Dienst nennt ihn ohnehin selbst in der URL.
          ports_exposes: String(spec.port),
          instant_deploy: false,
        },
      });
      if (created.uuid === undefined) {
        throw new Error('Deploy-Backend lieferte keine Referenz fuer die neue App');
      }
      return { backendRef: created.uuid };
    },

    async setEnv(backendRef, env): Promise<void> {
      // Coolify setzt Env-Variablen einzeln. Reihenfolge ist unerheblich,
      // deshalb parallel — aber mit allen Fehlern, nicht nur dem ersten.
      const results = await Promise.allSettled(
        Object.entries(env).map(([key, value]) =>
          call(`/applications/${backendRef}/envs`, {
            method: 'POST',
            body: { key, value, is_preview: false, is_build_time: false },
          }),
        ),
      );
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(
          `Env setzen fehlgeschlagen (${failed.length}): ${failed
            .map((f) => String(f.reason))
            .join('; ')}`,
        );
      }
    },

    async deploy(request: BackendDeployRequest): Promise<BackendDeployResult> {
      const result = await call<CoolifyDeployment>(
        `/deploy?uuid=${encodeURIComponent(request.backendRef)}&force=false`,
        { method: 'GET' },
      );
      return {
        backendRef: request.backendRef,
        ok: result.deployment_uuid !== undefined,
        ...(result.message === undefined ? {} : { message: result.message }),
      };
    },

    async status(backendRef): Promise<BackendStatus> {
      const app = await call<CoolifyApplication>(`/applications/${backendRef}`);
      return mapStatus(app.status);
    },

    async rollback(backendRef, gitSha): Promise<BackendDeployResult> {
      // Zurueck heisst: denselben Weg mit dem alten Commit gehen. Kein
      // Sonderpfad, damit das Ergebnis dem eines normalen Deploys entspricht.
      await call(`/applications/${backendRef}`, {
        method: 'PATCH',
        body: { git_commit_sha: gitSha },
      });
      const result = await call<CoolifyDeployment>(
        `/deploy?uuid=${encodeURIComponent(backendRef)}&force=true`,
        { method: 'GET' },
      );
      return {
        backendRef,
        ok: result.deployment_uuid !== undefined,
        ...(result.message === undefined ? {} : { message: result.message }),
      };
    },

    /**
     * Liest zurueck, was Coolify der App selbst gegeben hat.
     *
     * Unter ADR 0008 ist das eine **Negativ**-Messung, und das ist die
     * Umkehrung der alten Fassung: Vorher wurde geprueft, ob unsere Labels noch
     * stehen; jetzt wird geprueft, dass **keine** Traefik-Labels, kein
     * Host-Port und keine Domain an der App stehen. Jedes davon waere ein
     * Router ohne unsere Middlewares oder ein Weg am Gateway vorbei.
     *
     * Gelesen wird, was das Backend an dieser App **fuehrt** — nicht ein
     * `docker inspect`. Mehr gibt die REST-API nicht her, und es reicht: Was
     * Coolify fuehrt, gibt es bei jedem Start an den Container.
     *
     * `custom_labels` ist uneinheitlich kodiert (ADR 0008: Eingang base64,
     * Ausgang je nach Pfad base64 oder Klartext) — `parseCoolifyLabels` nimmt
     * beides. Und: Ohne `read:sensitive` oder `root` am API-Token liefert die
     * API `custom_labels` gar nicht (`ApiSensitiveData.php:14-19`); dann sieht
     * diese Messung einen leeren Satz, also „keine Labels", also kein Befund.
     * Das ist die eine Richtung, in der dieser Weg stumm sein kann.
     *
     * Jeder Fehler beim Lesen ist `unreachable` und **kein** Befund. Ein
     * Netzwerkfehler sagt nichts darueber, wie die App haengt.
     */
    async readAppGatewayFacts(backendRef): Promise<AppGatewayFactsReading> {
      let app: CoolifyApplication;
      try {
        app = await call<CoolifyApplication>(`/applications/${backendRef}`);
      } catch (cause) {
        return {
          state: 'unreachable',
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }

      if (typeof app !== 'object' || app === null || app.uuid === undefined) {
        // Keine verwertbare App-Antwort: Wir wissen nichts. Daraus einen Befund
        // zu machen hiesse, eine Formaenderung der API als Sicherheitsvorfall
        // zu melden.
        return { state: 'unreachable', reason: 'Antwort enthaelt keine App mit Referenz' };
      }

      return {
        state: 'read',
        facts: {
          labels: parseCoolifyLabels(app.custom_labels ?? ''),
          portsMappings: app.ports_mappings ?? '',
          // Coolify fuehrt die Domain je nach Fassung als `fqdn` oder
          // `domains`. Beide werden gelesen: Eine Domain, die nur in einem der
          // Felder steht, bringt denselben Router mit.
          domains: [app.fqdn ?? '', app.domains ?? '']
            .map((v) => v.trim())
            .filter((v) => v !== '')
            .join(','),
        },
      };
    },
  };
}

/**
 * `key=value` pro Zeile, wie Coolify die „custom labels" fuehrt — je nach
 * Version base64-kodiert (ADR 0008: Eingang verlangt base64, Ausgang liefert
 * je nach Pfad base64 oder Klartext mit Zeilenumbruechen).
 *
 * Beides wird akzeptiert, und die Unterscheidung haengt nicht mehr am Wort
 * `traefik.`: Unter ADR 0008 ist ein Label-Satz **ohne** `traefik.` der
 * Normalfall, und ein Satz, den wir falsch lesen, waere ein leerer Satz —
 * also „keine fremden Labels", also stillschweigend kein Befund. Die
 * Unterscheidung laeuft deshalb ueber das Alphabet: base64 enthaelt keinen
 * Punkt, kein Doppelpunkt und kein Leerzeichen.
 */
export function parseCoolifyLabels(raw: string): Readonly<Record<string, string>> {
  const text = decodeIfBase64(raw);

  const labels: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    labels[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return labels;
}

function decodeIfBase64(raw: string): string {
  const compact = raw.trim();
  if (compact === '' || !/^[A-Za-z0-9+/=\r\n]+$/.test(compact)) return raw;
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    return decoded.includes('=') ? decoded : raw;
  } catch {
    return raw;
  }
}

function mapStatus(raw: string | undefined): BackendStatus {
  if (raw === undefined) return 'unknown';
  const value = raw.toLowerCase();
  if (value.includes('running')) return 'running';
  if (value.includes('building') || value.includes('queued')) return 'building';
  if (value.includes('exited') || value.includes('stopped')) return 'stopped';
  if (value.includes('fail') || value.includes('error')) return 'failed';
  return 'unknown';
}
