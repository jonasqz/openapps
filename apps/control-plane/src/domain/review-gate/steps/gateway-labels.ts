/**
 * Label-Lint **vor** dem Deploy (Spec Woche 1, Abschnitt 1 Bausteintabelle,
 * Abschnitt 2 Fehlerfalltabelle, Abschnitt 3.3).
 *
 * Was dieser Schritt kann und was nicht — und das ist der wichtigere Teil des
 * Kommentars:
 *
 * Er prueft den Label-Satz, den die Control Plane fuer **diesen** Deploy
 * erzeugen wuerde. Dass dieser Satz vollstaendig ist, ist zum Teil eine
 * Pruefung gegen sich selbst: Erzeuger und Lint sitzen in derselben Datei
 * (`adapters/coolify/traefik.ts`). Eine solche Pruefung beweist nichts
 * darueber, was am Container ankommt — das tut erst die Messung **nach** dem
 * Deploy (`domain/deployments.ts`, `readGatewayLabels`).
 *
 * Was er trotzdem faengt, und nur er:
 *
 *  1. Die Ableitung scheitert schon vorher. Kein Port aus dem Manifest
 *     (`PORT="dreitausend"`), keine Domain, ein App-Name oder eine Domain, die
 *     als Label-Schluessel oder in einer Host-Regel nicht trägt. Das letzte ist
 *     keine Kosmetik: ein Backtick in der Domain beendet die
 *     ``Host(`...`)``-Regel, der Rest der Zeile ist dann Traefik-Syntax aus
 *     dem Manifest einer App.
 *  2. Der Label-Satz hat seine Bedeutung verloren. Kein Port-Label, keine
 *     Forward-Auth, kein Entfernen der mitgeschickten `X-Auth-*`-Header, eine
 *     fremde Middleware vor der Auth (Spec 2, „Middleware-Reihenfolge
 *     vertauscht"). Hier zahlt sich aus, dass der Lint den Satz **liest** und
 *     nicht mit einer Konstante vergleicht.
 *  3. Die Annahmen aus Spec 3.3, soweit die Arbeitskopie sie beantwortet:
 *     kein veroeffentlichter Host-Port, kein zweites Netz neben dem
 *     Gateway-Netz, und ein Manifest, das Labels, Ports oder Netze selbst
 *     setzen will.
 *
 * Deterministisch: Scheitert der Schritt selbst, blockiert er. Eine fehlende
 * Pruefung ist keine bestandene (`merge.ts`).
 */

import { appContainerPort } from '../../app-port';
import type { GatewayLabelLint, GatewayTarget } from '../../ports';
import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const GATEWAY_LABELS_STEP = 'gateway-labels';

export interface GatewayLabelsOptions {
  /**
   * Das eine Docker-Netz, in dem App und Gateway zusammen liegen (Spec 3.3).
   * Default `coolify` — der Netzname, den das Deploy-Backend von sich aus
   * benutzt. Ueber `GATEWAY_DOCKER_NETWORK` aenderbar.
   */
  readonly gatewayNetwork?: string;
}

const DEFAULT_GATEWAY_NETWORK = 'coolify';

/** Namen, die als Teil eines Traefik-Label-Schluessels tragen. */
const SAFE_APP_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Hostname, der in einer ``Host(`...`)``-Regel steht, ohne sie zu verlassen.
 * Keine Backticks, keine Leerzeichen, keine Kommata, keine Klammern.
 */
const SAFE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

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

export function gatewayLabelsStep(
  lint: GatewayLabelLint,
  options: GatewayLabelsOptions = {},
): ReviewStep {
  const gatewayNetwork = options.gatewayNetwork ?? DEFAULT_GATEWAY_NETWORK;

  return {
    name: GATEWAY_LABELS_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      if (input.gateway === undefined) {
        // Kein Ziel heisst: nichts pruefbar. Ein `skipped` waere hier falsch —
        // es wuerde den Deploy durchlassen, ohne dass der Lint lief.
        return {
          step: GATEWAY_LABELS_STEP,
          kind: 'deterministic',
          findings: [],
          error:
            'kein Gateway-Ziel im Review-Eingang — ohne App-Name und Domain ist der Label-Lint nicht pruefbar',
        };
      }

      return {
        step: GATEWAY_LABELS_STEP,
        kind: 'deterministic',
        findings: checkGatewayLabels(input, lint, gatewayNetwork),
      };
    },
  };
}

export function checkGatewayLabels(
  input: ReviewInput,
  lint: GatewayLabelLint,
  gatewayNetwork: string = DEFAULT_GATEWAY_NETWORK,
): readonly Finding[] {
  const findings: Finding[] = [];
  /** Die Ableitung selbst traegt nicht — dann gibt es keinen Satz zu lesen. */
  let derivationBroken = false;
  const blocking = (code: string, message: string): void => {
    findings.push({ step: GATEWAY_LABELS_STEP, severity: 'blocking', code, message });
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
      `App-Name "${target.appName}" taugt nicht als Teil eines Label-Schluessels ([a-z0-9-], nicht am Rand)`,
    );
  }

  const domain = target.domain?.trim() ?? '';
  if (domain === '') {
    brokenDerivation(
      'gateway.missing_domain',
      'die App hat keine Domain — ohne Domain gibt es keinen Router und keine Forward-Auth (Spec 1.2)',
    );
  } else if (!SAFE_DOMAIN.test(domain)) {
    brokenDerivation(
      'gateway.unsafe_domain',
      `Domain "${domain}" taugt nicht als Host-Regel: ein Zeichen darin kann die Regel verlassen`,
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

  // Ohne brauchbaren Namen, Domain oder Port gibt es keinen Satz zu
  // beurteilen. Der Befund steht schon, also hier nur noch zurueck. Befunde
  // aus dem Manifest und aus der Arbeitskopie halten den Lint nicht auf — sie
  // sollen zusammen mit den Label-Befunden im Bericht stehen.
  if (derivationBroken || port === undefined) {
    return findings;
  }

  const resolved: GatewayTarget = { appName: target.appName, domain, port };
  const plan = lint.plan(resolved);

  if (plan.servicePort !== String(port)) {
    blocking(
      'gateway.missing_port_label',
      `der Label-Satz traegt den Port "${plan.servicePort ?? '—'}", erwartet "${String(port)}" — ` +
        'ohne Port-Label raet Traefik aus dem EXPOSE des Images und der Router kommt nicht hoch',
    );
  }
  if (!plan.forwardsAuth) {
    blocking(
      'gateway.missing_forward_auth',
      'der Label-Satz enthaelt keine Forward-Auth-Middleware am Router dieser App',
    );
  } else if (
    plan.forwardAuthAddress === undefined ||
    !/^https?:\/\/\S+$/.test(plan.forwardAuthAddress)
  ) {
    blocking(
      'gateway.invalid_forward_auth_address',
      `die Forward-Auth zeigt auf "${plan.forwardAuthAddress ?? '—'}" — das ist keine Adresse`,
    );
  }
  if (!plan.stripsIdentityHeaders) {
    blocking(
      'gateway.missing_strip',
      'der Label-Satz entfernt die mitgeschickten X-Auth-*-Header nicht vor der Forward-Auth — ' +
        'ein Client koennte seine eigene Identitaet mitschicken (ADR 0004)',
    );
  }
  if (plan.hostRule === undefined || !plan.hostRule.includes(domain)) {
    blocking(
      'gateway.missing_host_rule',
      `die Host-Regel des Routers ist "${plan.hostRule ?? '—'}" und nennt die Domain "${domain}" nicht`,
    );
  }
  if (plan.middlewares.length !== 2) {
    // Genau zwei: entfernen, dann pruefen. Eine dritte Middleware am Router
    // dieser App haette die Control Plane nicht gesetzt — und eine, die vor
    // der Auth laeuft, ist der Fall „Middleware-Reihenfolge vertauscht" aus
    // Spec 2.
    blocking(
      'gateway.unexpected_middlewares',
      `der Router traegt die Middleware-Kette [${plan.middlewares.join(', ')}], erwartet genau zwei ` +
        '(Header entfernen, dann Forward-Auth)',
    );
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
        step: GATEWAY_LABELS_STEP,
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
      step: GATEWAY_LABELS_STEP,
      severity: 'warning',
      code: 'gateway.container_facts_unknown',
      message:
        'veroeffentlichte Host-Ports und Docker-Netze der Arbeitskopie wurden nicht erhoben — ' +
        'die Annahme aus Spec 3.3 ist fuer diesen Deploy ungeprueft',
    });
  }

  for (const port of publishedPorts ?? []) {
    findings.push({
      step: GATEWAY_LABELS_STEP,
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
        step: GATEWAY_LABELS_STEP,
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
