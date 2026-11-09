import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * Erlaubte Importquellen für App-Code.
 *
 * Allowlist statt Blocklist: eine neue UI-Bibliothek ist damit automatisch
 * verboten, ohne dass jemand sie vorher kennen muss.
 */
export const DEFAULT_ALLOWED = [
  '@openapps/ui',
  '@openapps/sdk',
  '@openapps/app-manifest',
  'react',
  'react-dom',
  'next',
  'tailwindcss',
  'tailwindcss-animate',
];

/** Relative Importe sind immer der eigene Code. */
/**
 * Eigener Code der App, nie ein Fremdpaket: relative Pfade, absolute Pfade und
 * die üblichen Pfad-Aliase auf das eigene `src` (`@/lib/items`, `~/lib`,
 * `#lib`). Ohne diese Aliase meldet die Regel jeder App ihre eigenen Importe —
 * genau das ist beim ersten Template-Durchlauf passiert.
 *
 * `@openapps/...` bleibt davon unberührt: ein Scope mit Namen ist ein Paket,
 * `@/` ohne Paketnamen ist ein Alias.
 */
const ALWAYS_LOCAL = /^(?:[./]|@\/|~\/|#)/;

/** Vorgabe-Dateiname für die Liste, die die Control Plane pflegt. */
export const DEFAULT_ALLOWLIST_FILE = 'allowed-packages.json';

/** Einmal gelesene Dateien, je Pfad. `null` heißt: Datei gibt es nicht. */
const fileCache = new Map();

/**
 * Liest die zusätzlich erlaubten Pakete aus einer JSON-Datei.
 *
 * Format — eine Liste von Paketnamen:
 *
 * ```json
 * ["date-fns", "zod", "@tanstack/react-query"]
 * ```
 *
 * Alternativ ein Objekt mit `allow`, damit Platz für Kommentare bleibt:
 *
 * ```json
 * { "_kommentar": "Gepflegt von der Control Plane.", "allow": ["zod"] }
 * ```
 *
 * **Fehlt die Datei, gilt nur die eingebaute Allowlist — nie „alles erlaubt".**
 * Dasselbe bei kaputtem JSON: dann meldet die Regel den Fehler einmal und
 * bleibt streng.
 */
function readAllowlistFile(filePath) {
  if (fileCache.has(filePath)) return fileCache.get(filePath);

  let result;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.allow;
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
      result = { packages: [], error: `${filePath}: erwartet wird eine Liste von Paketnamen.` };
    } else {
      result = { packages: list, error: null };
    }
  } catch (cause) {
    result =
      cause?.code === 'ENOENT'
        ? null
        : { packages: [], error: `${filePath}: ${cause?.message ?? 'nicht lesbar'}` };
  }

  fileCache.set(filePath, result);
  return result;
}

/** Nur für Tests: gelesene Dateien vergessen. */
export function clearAllowlistCache() {
  fileCache.clear();
}

function packageName(source) {
  if (source.startsWith('@')) {
    const [scope, name] = source.split('/');
    return name === undefined ? scope : `${scope}/${name}`;
  }
  return source.split('/')[0];
}

/**
 * Blockiert Imports aus fremden UI-Bibliotheken.
 *
 * Guide-Regeln: „Nur Komponenten aus `@openapps/ui`" und „Keine zweite
 * UI-Bibliothek".
 */
export const noForeignUi = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Nur @openapps/ui, React, Next und Tailwind-Utilities importieren — keine zweite UI-Bibliothek.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Ersetzt die eingebaute Allowlist vollständig. */
          allow: { type: 'array', items: { type: 'string' } },
          /** Zusätzliche Pakete, direkt in der Config genannt. */
          allowExtra: { type: 'array', items: { type: 'string' } },
          /**
           * Datei mit zusätzlich erlaubten Paketen, gepflegt von der Control
           * Plane. Relativ zum Projekt-Wurzelverzeichnis (`cwd` von ESLint).
           * Vorgabe: `allowed-packages.json`. Fehlt sie, gilt nur die
           * eingebaute Allowlist.
           */
          allowExtraFile: { type: 'string' },
          /** Datei nicht lesen (z. B. in Tests). */
          useAllowlistFile: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      foreign:
        'Import aus "{{source}}" ist nicht erlaubt. UI kommt aus @openapps/ui; erlaubt sind außerdem: {{allowed}}. Ein weiteres Paket trägt die Control Plane in {{file}} ein.',
      badAllowlist:
        'Die Liste erlaubter Pakete ist nicht lesbar: {{reason}} Es gilt nur die eingebaute Allowlist.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const fileName = options.allowExtraFile ?? DEFAULT_ALLOWLIST_FILE;
    const filePath = isAbsolute(fileName) ? fileName : resolve(context.cwd ?? process.cwd(), fileName);

    let fromFile = null;
    if (options.useAllowlistFile !== false) {
      fromFile = readAllowlistFile(filePath);
    }

    const allowed = new Set([
      ...(options.allow ?? DEFAULT_ALLOWED),
      ...(options.allowExtra ?? []),
      ...(fromFile?.packages ?? []),
    ]);

    let reportedBadFile = false;
    const reportBadFile = (node) => {
      if (reportedBadFile || fromFile?.error == null) return;
      reportedBadFile = true;
      context.report({ node, messageId: 'badAllowlist', data: { reason: fromFile.error } });
    };

    const check = (node, source) => {
      if (typeof source !== 'string' || source === '') return;
      if (ALWAYS_LOCAL.test(source)) return;
      if (source.startsWith('node:')) return;
      reportBadFile(node);
      if (allowed.has(packageName(source))) return;
      context.report({
        node,
        messageId: 'foreign',
        data: { source, allowed: [...allowed].sort().join(', '), file: fileName },
      });
    };

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source !== null && node.source !== undefined) check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          const first = node.arguments[0];
          if (first !== undefined && first.type === 'Literal') check(node, first.value);
        }
      },
    };
  },
};
