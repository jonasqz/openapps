/**
 * Konfigurations-Lint **vor** dem Deploy (Spec Woche 1, Abschnitt 1
 * Bausteintabelle, Abschnitt 2 Fehlerfalltabelle, Abschnitt 3.3 — unter
 * ADR 0008 auf die eigene dynamische Konfiguration gezogen).
 *
 * Was dieser Schritt kann und was nicht, und das ist der wichtigere Teil des
 * Kommentars:
 *
 * Er erzeugt die Gateway-Konfiguration, die dieser Deploy bekaeme, und liest
 * sie. Dass sie traegt, ist zum Teil eine Pruefung gegen sich selbst —
 * Erzeuger und Lint liegen beide in `domain/gateway-config.ts`. Was wirklich
 * auf dem Host liegt, messen erst `verify` nach dem Deploy
 * (`domain/deployments.ts`) und der Startup-Check gegen die Traefik-API
 * (`infra/gateway-guard.ts`).
 *
 * Was er trotzdem faengt, und nur er:
 *
 *  1. Die Ableitung scheitert schon vorher. Kein Port aus dem Manifest
 *     (`PORT="dreitausend"`), keine Domain, ein App-Name oder eine Domain, die
 *     in einer Host-Regel nicht traegt. Das letzte ist keine Kosmetik: ein
 *     Backtick in der Domain beendet die ``Host(`...`)``-Regel, der Rest der
 *     Zeile ist dann Traefik-Syntax aus dem Manifest einer App.
 *  2. Die erzeugte Konfiguration hat ihre Bedeutung verloren: ein Router ohne
 *     die zwei Middlewares, in falscher Reihenfolge, ein Dienst ohne Adresse,
 *     ein fehlender Catch-all. Der Typ `GuardedRouter` macht den ersten Fall
 *     unkonstruierbar; dieser Lint faengt ihn auch dann, wenn ihn jemand mit
 *     einem Cast erzwingt.
 *  3. Die Annahmen aus Spec 3.3, soweit die Arbeitskopie sie beantwortet:
 *     kein veroeffentlichter Host-Port, kein zweites Netz neben dem
 *     Gateway-Netz, und ein Manifest, das Labels, Ports oder Netze selbst
 *     setzen will.
 *
 * Deterministisch: Scheitert der Schritt selbst, blockiert er. Eine fehlende
 * Pruefung ist keine bestandene (`merge.ts`).
 */

import { appContainerPort } from '../../app-port';
import {
  buildGatewayConfig,
  gatewayConfigProblems,
  gatewayRouterNameFor,
} from '../../gateway-config';
import type { GatewaySettings } from '../../context';
import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const GATEWAY_CONFIG_STEP = 'gateway-config';

export interface GatewayConfigStepOptions {
  /**
   * Das eine Docker-Netz, in dem App und Gateway zusammen liegen (Spec 3.3).
   * Default `coolify` — der Netzname, den das Deploy-Backend von sich aus
   * benutzt. Ueber `GATEWAY_DOCKER_NETWORK` aenderbar.
   */
  readonly gatewayNetwork?: string;
}

const DEFAULT_GATEWAY_NETWORK = 'coolify';

/** Namen, die als Router- und Dienstname tragen. */
const SAFE_APP_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Env-Variablen, mit denen eine App die Infrastruktur selbst konfigurieren
 * will. Spec 3.3 und Spec 2 („App-Container direkt erreichbar"): Labels, Ports
 * und Netze vergibt die Plattform, nicht die App.
 */
const RESERVED_ENV_PREFIXES = ['TRAEFIK_', 'COOLIFY_', 'DOCKER_'];
const RESERVED_ENV_NAMES = [
  'PORTS',
  'HOST_PORT',
  'PUBLISH_PORT',
  'PUBLISHED_PORT',
  'NETWORK',
  'NETWORKS',
  'CUSTOM_LABELS',
];

export function gatewayConfigStep(
  settings: GatewaySettings,
  options: GatewayConfigStepOptions = {},
): ReviewStep {
  const gatewayNetwork = options.gatewayNetwork ?? DEFAULT_GATEWAY_NETWORK;

  return {
    name: GATEWAY_CONFIG_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      if (input.gateway === undefined) {
        // Kein Ziel heisst: nichts pruefbar. Ein `skipped` waere hier falsch —
        // es wuerde den Deploy durchlassen, ohne dass der Lint lief.
        return {
          step: GATEWAY_CONFIG_STEP,
          kind: 'deterministic',
          findings: [],
          error:
            'kein Gateway-Ziel im Review-Eingang — ohne App-Name und Domain ist der Konfigurations-Lint nicht pruefbar',
        };
      }

      return {
        step: GATEWAY_CONFIG_STEP,
        kind: 'deterministic',
        findings: checkGatewayConfig(input, settings, gatewayNetwork),
      };
    },
  };
}

export function checkGatewayConfig(
  input: ReviewInput,
  settings: GatewaySettings,
  gatewayNetwork: string = DEFAULT_GATEWAY_NETWORK,
): readonly Finding[] {
  const findings: Finding[] = [];
  /** Die Ableitung selbst traegt nicht — dann gibt es keine Konfiguration. */
  let derivationBroken = false;
  const blocking = (code: string, message: string): void => {
    findings.push({ step: GATEWAY_CONFIG_STEP, severity: 'blocking', code, message });
  };
  const brokenDerivation = (code: string, message: string): void => {
    derivationBroken = true;
    blocking(code, message);
  };

  const target = input.gateway;
  if (target === undefined) {
    blocking('gateway.no_target', 'kein Gateway-Ziel im Review-Eingang');
    return findings;
  }

  findings.push(...manifestInfrastructureFindings(input));
  findings.push(...containerReachabilityFindings(input, gatewayNetwork));

  if (!SAFE_APP_NAME.test(target.appName)) {
    brokenDerivation(
      'gateway.unsafe_app_name',
      `App-Name "${target.appName}" taugt nicht als Router- und Dienstname ([a-z0-9-], nicht am Rand)`,
    );
  }

  const domain = target.domain?.trim() ?? '';
  if (domain === '') {
    brokenDerivation(
      'gateway.missing_domain',
      'die App hat keine Domain — ohne die gemeinsame Domain gibt es keinen Router und keine Forward-Auth (ADR 0007)',
    );
  }

  let port: number | undefined;
  try {
    port = appContainerPort({ name: target.appName, manifest: input.manifest });
  } catch (cause) {
    brokenDerivation(
      'gateway.invalid_port',
      `Port aus dem Manifest unbrauchbar: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  // Ohne brauchbaren Namen, Domain oder Port gibt es nichts zu erzeugen. Der
  // Befund steht schon. Befunde aus dem Manifest und aus der Arbeitskopie
  // halten den Lint nicht auf — sie sollen zusammen im Bericht stehen.
  if (derivationBroken || port === undefined) {
    return findings;
  }

  // Die Konfiguration, die dieser Deploy bekaeme. Absichtlich nur mit **dieser**
  // App: Der Schritt urteilt ueber diesen Deploy, und ein Befund an einer
  // anderen App wuerde sonst diesen hier blockieren.
  let problems: readonly string[];
  try {
    const config = buildGatewayConfig({
      ...settings,
      appsDomain: domain,
      apps: [{ appName: target.appName, port }],
    });
    problems = gatewayConfigProblems(config);

    const router = config.http.routers[gatewayRouterNameFor(target.appName)];
    if (router === undefined) {
      blocking(
        'gateway.missing_router',
        `die erzeugte Konfiguration enthaelt keinen Router fuer "${target.appName}"`,
      );
    } else if (!router.rule.includes(`Host(\`${domain}\`)`)) {
      blocking(
        'gateway.missing_host_rule',
        `die Regel des Routers ist "${router.rule}" und nennt die Domain "${domain}" nicht`,
      );
    } else if (!router.rule.includes(`PathPrefix(\`/${target.appName}\`)`)) {
      blocking(
        'gateway.missing_path_prefix',
        `die Regel des Routers ist "${router.rule}" und nennt den Pfad "/${target.appName}" nicht — ` +
          'unter ADR 0007 trennt der Pfad die Apps, nicht der Host',
      );
    }
  } catch (cause) {
    // Der Generator weist ab, was er nicht sicher schreiben kann (eine Domain
    // mit einem Backtick, ein Alias mit einem Doppelpunkt). Das ist ein
    // Befund, kein Fehler des Schrittes.
    blocking(
      'gateway.config_rejected',
      `die Gateway-Konfiguration liess sich nicht erzeugen: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return findings;
  }

  for (const problem of problems) {
    blocking('gateway.config_problem', problem);
  }

  return findings;
}

/**
 * Was das Manifest selbst verraet. Das Manifest-Schema
 * (`@openapps/app-manifest`) hat **kein** Feld fuer veroeffentlichte Ports und
 * keines fuer Docker-Netze, und es ist `.strict()` — eine App kann beides
 * darin also nicht deklarieren. Pruefbar ist deshalb nur der Umweg: eine
 * Env-Variable, mit der die App Ports, Netze oder Labels selbst zu setzen
 * versucht.
 */
function manifestInfrastructureFindings(input: ReviewInput): readonly Finding[] {
  const findings: Finding[] = [];
  for (const entry of input.manifest.env) {
    const reserved =
      RESERVED_ENV_PREFIXES.some((prefix) => entry.name.startsWith(prefix)) ||
      RESERVED_ENV_NAMES.includes(entry.name);
    if (reserved) {
      findings.push({
        step: GATEWAY_CONFIG_STEP,
        severity: 'blocking',
        code: 'gateway.manifest_sets_infrastructure',
        message:
          `das Manifest deklariert "${entry.name}" — Labels, Ports und Netze vergibt die ` +
          'Plattform (Spec 3.3), nicht die App',
      });
    }
  }
  return findings;
}

/**
 * Spec 3.3: kein veroeffentlichter Host-Port, kein zweites Netz. Beides steht
 * nicht im Manifest, sondern in der Arbeitskopie (`docker-compose.yml`,
 * Startskript) — und kommt deshalb als `codeFacts` herein, derselbe Weg wie
 * `tables` und `tools`.
 *
 * Solange niemand diese Tatsachen erhebt, ist `undefined` die Wahrheit „nicht
 * erhoben". Das wird als Hinweis gemeldet und blockiert **nicht**: Ein
 * blockierender Befund waere hier nicht Default-Deny, sondern ein Gate, das
 * jeden Deploy aufhaelt, bis der Sammler existiert. Die Entscheidung, ob das
 * spaeter blockiert, steht im Bericht als offene Frage.
 */
function containerReachabilityFindings(
  input: ReviewInput,
  gatewayNetwork: string,
): readonly Finding[] {
  const findings: Finding[] = [];
  const { publishedPorts, dockerNetworks } = input.codeFacts;

  if (publishedPorts === undefined || dockerNetworks === undefined) {
    findings.push({
      step: GATEWAY_CONFIG_STEP,
      severity: 'warning',
      code: 'gateway.container_facts_unknown',
      message:
        'veroeffentlichte Host-Ports und Docker-Netze der Arbeitskopie wurden nicht erhoben — ' +
        'die Annahme aus Spec 3.3 ist fuer diesen Deploy ungeprueft',
    });
  }

  for (const port of publishedPorts ?? []) {
    findings.push({
      step: GATEWAY_CONFIG_STEP,
      severity: 'blocking',
      code: 'gateway.published_port',
      message:
        `die App veroeffentlicht den Host-Port "${port}" — dann ist der Container am Gateway ` +
        'vorbei erreichbar und die Signatur aus Spec 3.2 ist wertlos',
    });
  }

  for (const network of dockerNetworks ?? []) {
    if (network !== gatewayNetwork) {
      findings.push({
        step: GATEWAY_CONFIG_STEP,
        severity: 'blocking',
        code: 'gateway.extra_network',
        message:
          `die App liegt im Netz "${network}" neben dem Gateway-Netz "${gatewayNetwork}" — ` +
          'Spec 3.3 erlaubt genau ein Netz',
      });
    }
  }

  return findings;
}
