/**
 * Implementierung von `DeploymentBackend` gegen die Coolify-REST-API.
 *
 * Sie uebersetzt in beide Richtungen: aus neutralen Begriffen der Domaene
 * werden Coolify-Endpunkte, und aus Coolify-Antworten werden neutrale
 * Ergebnisse. Wenn Coolify nicht traegt, wird genau diese Datei ersetzt
 * (Abbruchpfad aus dem Brief) — und nichts anderes.
 */

import type {
  BackendAppSpec,
  BackendDeployRequest,
  BackendDeployResult,
  BackendStatus,
  DeploymentBackend,
  GatewayLabelReading,
} from '../../domain/ports';
import type { CoolifyConfig } from './config';
import { forwardAuthLabels } from './traefik';

interface CoolifyApplication {
  readonly uuid?: string;
  readonly status?: string;
  /**
   * Die „custom labels" der App — eine Zeile pro Label, `key=value`. Coolify
   * gibt sie je nach Version base64-kodiert zurueck; `parseCoolifyLabels`
   * nimmt beides.
   */
  readonly custom_labels?: string | null;
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
          domains: spec.domain,
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

    async setDomain(backendRef, domain): Promise<void> {
      await call(`/applications/${backendRef}`, {
        method: 'PATCH',
        body: { domains: domain },
      });
    },

    async ensureGateway(backendRef, spec): Promise<void> {
      // Hier entsteht die Traefik-Konfiguration: die Labels kommen aus
      // `traefik.ts`, Coolify uebergibt sie als "custom labels" an Traefik.
      const labels = forwardAuthLabels({
        appName: spec.appName,
        domain: spec.domain,
        port: spec.port,
        forwardAuthUrl: config.forwardAuthUrl,
      });
      await call(`/applications/${backendRef}`, {
        method: 'PATCH',
        body: {
          custom_labels: Object.entries(labels)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n'),
          is_container_label_escape_enabled: false,
        },
      });
    },

    /**
     * Liest die Labels zurueck, mit denen diese App am Gateway haengt.
     *
     * Was das hier genau ist — und was nicht: Gelesen wird der Label-Satz, den
     * das Deploy-Backend an dieser App **fuehrt** und bei jedem Start an den
     * Container gibt, nicht die Labels aus einem `docker inspect`. Mehr gibt
     * die REST-API nicht her. Das reicht fuer den Fall, der im Gateway-Lauf
     * wirklich passiert ist (alle Traefik-Labels weg, docs/nachweise/
     * dod-02-laeufe), und es ist eine Messung und keine Ableitung: Steht hier
     * etwas anderes als das, was `ensureGateway` gesetzt hat, hat es jemand
     * oder etwas geaendert.
     *
     * Jeder Fehler beim Lesen ist `unreachable` und **kein** Befund. Ein
     * Netzwerkfehler sagt nichts darueber, wie die App haengt.
     */
    async readGatewayLabels(backendRef): Promise<GatewayLabelReading> {
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
        // Keine verwertbare App-Antwort: Wir wissen nichts ueber die Labels.
        // Daraus einen Befund zu machen hiesse, eine Formaenderung der API als
        // Sicherheitsvorfall zu melden.
        return { state: 'unreachable', reason: 'Antwort enthaelt keine App mit Referenz' };
      }

      // Eine App **ohne** Labels ist dagegen eine Messung: genau so sieht es
      // aus, wenn ein Update den Satz entfernt hat.
      return { state: 'read', labels: parseCoolifyLabels(app.custom_labels ?? '') };
    },
  };
}

/**
 * `key=value` pro Zeile, wie Coolify die „custom labels" fuehrt — je nach
 * Version base64-kodiert. Beides wird akzeptiert: Entscheidend ist, dass ein
 * fehlendes Label nicht als „base64-Muell" durchgeht und damit stillschweigend
 * zu einem leeren Satz wird (der dann als Befund gemeldet wuerde, obwohl wir
 * nur falsch gelesen haben).
 */
export function parseCoolifyLabels(raw: string): Readonly<Record<string, string>> {
  const text = raw.includes('=') && raw.includes('traefik.') ? raw : decodeIfBase64(raw);

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
