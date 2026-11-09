/**
 * Wie die erzeugte Gateway-Konfiguration auf den Host kommt — und wie sie
 * zurueckgelesen wird (ADR 0008).
 *
 * ## Der Weg: ein gemountetes Verzeichnis
 *
 * Die Control Plane schreibt in ein Verzeichnis, das ihr Container gemountet
 * hat; auf dem Host ist das `/data/coolify/proxy/dynamic`. Traefiks
 * File-Provider steht dort mit `watch: true` (ADR 0008,
 * `proxy.php:774-775`, `:791`) und laedt die Datei ohne Neustart neu.
 *
 * **Warum dieser Weg und nicht Coolifys API oder SSH** — es ist der Weg mit
 * den wenigsten Rechten:
 *
 * - **Coolifys API** haette bedeutet, die Datei ueber einen Endpunkt zu
 *   schreiben, der Dateien auf dem Server ablegt. Ein Token mit diesem Recht
 *   kann mehr als eine Datei schreiben, und ADR 0008 nennt ohnehin schon, dass
 *   unser Token fuer `custom_labels` `read:sensitive` oder `root` braucht.
 *   Dieses Recht noch auf einen Schreibweg auszudehnen, vergroessert den
 *   Schaden eines gestohlenen Tokens.
 * - **SSH** haette einen Schluessel mit Shell-Zugang auf dem Host bedeutet,
 *   also das Recht, alles zu tun, um eine Datei zu schreiben.
 * - **Der Mount** gibt genau ein Recht: Schreiben in genau ein Verzeichnis.
 *   Kein Token, kein Schluessel, kein Prozessstart.
 *
 * **Die Annahme, die er macht, und sie ist nicht klein:** Die Control Plane
 * laeuft auf demselben Server wie der Proxy, und dieser Mount ist in ihrer
 * Coolify-Dienstdefinition eingetragen. Faellt die Annahme — mehrere Server,
 * Proxy auf einem anderen Host —, traegt dieser Weg nicht, und es braucht
 * einen Agenten auf dem Proxy-Host oder doch SSH. Fehlt der Mount, scheitert
 * der erste Deploy mit einem Fehler, der das Verzeichnis nennt; er scheitert
 * **nicht** still.
 *
 * ## Geschrieben wird atomar
 *
 * Temporaerdatei im **selben** Verzeichnis, dann `rename`. Der File-Provider
 * sieht damit nie eine halb geschriebene Datei — sonst waeren fuer einen
 * Augenblick alle Router weg, und das heisst bei uns: alle Apps am Catch-all.
 *
 * ## Zurueckgelesen wird der Text, nicht eine geparste Form
 *
 * `verify` vergleicht den Inhalt der Datei mit dem, was wir jetzt schreiben
 * wuerden — Zeichen fuer Zeichen. Kein YAML-Parser: Ein Parser waere eine
 * Abhaengigkeit mehr und eine zweite Lesart derselben Datei. Was wirklich
 * laeuft, prueft ohnehin der Startup-Check gegen die Traefik-API
 * (`gateway-guard.ts`) — die Datei sagt nur, was dort stehen soll.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayConfigStore, GatewayConfigVerification } from '../domain/ports';
import type { GatewayDynamicConfig } from '../domain/gateway-config';

/**
 * Reservierte Dateinamen, die Coolify selbst in diesem Verzeichnis
 * ueberschreibt (ADR 0008, `Server.php:748-783`). Keiner von ihnen ist unser
 * Name — und damit das so bleibt, steht die Liste hier und wird geprueft.
 */
export const RESERVED_DYNAMIC_FILENAMES: readonly string[] = [
  'coolify.yaml',
  'default_redirect_503.yaml',
  'coolify-maintenance.yaml',
  'default_redirect_404.yaml',
];

export const GATEWAY_CONFIG_FILENAME = 'openapps.yaml';

export interface FileGatewayConfigStoreOptions {
  /**
   * Das gemountete Verzeichnis im Container. Default `/traefik/dynamic`, auf
   * dem Host `/data/coolify/proxy/dynamic`.
   */
  readonly directory: string;
  readonly filename?: string;
}

export function createFileGatewayConfigStore(
  options: FileGatewayConfigStoreOptions,
): GatewayConfigStore {
  const filename = options.filename ?? GATEWAY_CONFIG_FILENAME;
  if (RESERVED_DYNAMIC_FILENAMES.includes(filename)) {
    // Ein reservierter Name heisst: Coolify schreibt die Datei beim naechsten
    // Proxy-Start neu, und alle Router sind weg. Das ist kein Laufzeitfehler,
    // den man melden kann — es ist einer, der den Start verhindern muss.
    throw new Error(
      `"${filename}" ist ein von Coolify reservierter Dateiname (ADR 0008) und wuerde ueberschrieben`,
    );
  }
  const path = join(options.directory, filename);

  return {
    async publish(config: GatewayDynamicConfig): Promise<void> {
      const text = renderGatewayConfig(config);
      // Temporaerdatei **im selben Verzeichnis**: `rename` ist nur innerhalb
      // eines Dateisystems atomar.
      const temporary = `${path}.tmp`;
      await writeFile(temporary, text, { encoding: 'utf8', mode: 0o644 });
      await rename(temporary, path);
    },

    async verify(config: GatewayDynamicConfig): Promise<GatewayConfigVerification> {
      let actual: string;
      try {
        actual = await readFile(path, 'utf8');
      } catch (cause) {
        // Nicht lesbar ist **kein** Befund ueber die Konfiguration.
        return {
          state: 'unreachable',
          reason: `${path} nicht lesbar: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
      return compareGatewayConfig(actual, config, path);
    },
  };
}

/**
 * Der Vergleich, getrennt vom Dateizugriff — damit er ohne Dateisystem
 * pruefbar ist.
 */
export function compareGatewayConfig(
  actual: string,
  expected: GatewayDynamicConfig,
  path: string,
): GatewayConfigVerification {
  const want = renderGatewayConfig(expected);
  if (actual === want) return { state: 'match' };

  const actualLines = actual.split('\n');
  const wantLines = want.split('\n');
  const problems: string[] = [];
  for (let index = 0; index < Math.max(actualLines.length, wantLines.length); index += 1) {
    if (actualLines[index] === wantLines[index]) continue;
    problems.push(
      `${path} weicht in Zeile ${String(index + 1)} ab: steht "${actualLines[index] ?? '—'}", ` +
        `erwartet "${wantLines[index] ?? '—'}"`,
    );
    // Drei Abweichungen reichen fuer den Bericht; der Rest ist Rauschen aus
    // derselben Ursache.
    if (problems.length === 3) break;
  }
  return { state: 'mismatch', problems };
}

/* -------------------------------------------------------------------------- */
/* YAML                                                                        */
/* -------------------------------------------------------------------------- */

type Renderable = string | number | boolean | readonly Renderable[] | { [key: string]: unknown };

/**
 * Die Konfiguration als YAML. Absichtlich ein eigener, kleiner Renderer und
 * keine Bibliothek: Die erzeugten Werte sind Zeichenketten, Zahlen,
 * Wahrheitswerte, Listen und Objekte — mehr gibt es in dieser Struktur nicht,
 * und eine Abhaengigkeit fuer vierzig Zeilen waere eine Abhaengigkeit zu viel.
 *
 * Jede Zeichenkette wird **immer** in Anfuehrungszeichen gesetzt. Das ist der
 * Punkt, an dem ein selbst gebauter Renderer sonst falsch wird: Werte wie
 * `Host(`a.test`)`, `true`, `3000` oder ein leerer Wert (der einen Header
 * loescht) muessen Zeichenketten bleiben. Schluessel ebenso — sonst wird
 * `X-Auth-Groups: ''` zu einem Schluessel, den ein YAML-Parser anders liest
 * als wir ihn meinen.
 *
 * Die Reihenfolge der Schluessel ist die Einfuegereihenfolge des Generators und
 * damit stabil — `verify` vergleicht Text, also muss derselbe Eingang
 * denselben Text ergeben.
 */
export function renderGatewayConfig(config: GatewayDynamicConfig): string {
  const header = [
    '# Erzeugt von der openapps Control Plane (ADR 0008). Nicht von Hand aendern:',
    '# Der Konfigurations-Lint nach jedem Deploy vergleicht diese Datei mit dem,',
    '# was der Generator in apps/control-plane/src/domain/gateway-config.ts ausgibt,',
    '# und meldet jede Abweichung als Befund.',
    '#',
    '# Jeder Router hier traegt beide Middlewares, in dieser Reihenfolge:',
    '# erst die eingehenden X-Auth-* loeschen, dann die Forward-Auth. Es gibt',
    '# keine Stelle mehr, die das global erzwingt.',
    '',
  ].join('\n');
  return `${header}${renderValue(config as unknown as Renderable, 0)}`;
}

function renderValue(value: Renderable, indent: number): string {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value.map((entry) => `${pad}- ${renderInline(entry)}\n`).join('');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([key, raw]) => {
        const child = raw as Renderable;
        if (child === undefined) return '';
        if (typeof child === 'object' && !Array.isArray(child)) {
          const inner = renderValue(child, indent + 2);
          // Leeres Objekt bleibt in der Zeile: `tls: {}`.
          return inner.trim() === '{}'
            ? `${pad}${quote(key)}: {}\n`
            : `${pad}${quote(key)}:\n${inner}`;
        }
        if (Array.isArray(child)) {
          return child.length === 0
            ? `${pad}${quote(key)}: []\n`
            : `${pad}${quote(key)}:\n${renderValue(child, indent + 2)}`;
        }
        return `${pad}${quote(key)}: ${renderInline(child)}\n`;
      })
      .join('');
  }

  return `${pad}${renderInline(value)}\n`;
}

function renderInline(value: Renderable): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(renderInline).join(', ')}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  return `{${entries.map(([key, raw]) => `${quote(key)}: ${renderInline(raw as Renderable)}`).join(', ')}}`;
}

/** Doppelte Anfuehrungszeichen mit Escapes — gueltig in YAML wie in JSON. */
function quote(value: string): string {
  return JSON.stringify(value);
}
