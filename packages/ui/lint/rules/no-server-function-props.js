/**
 * Keine Funktion aus einer Server-Komponente in eine Client-Komponente.
 *
 * React reicht keine Funktion über diese Grenze; der Build bricht mit
 * „Functions cannot be passed directly to Client Components". Statisch
 * nachweisbar ist das dort, wo eine Datei **sicher** serverseitig rendert:
 * eine Datei ohne `'use client'`, die eine Seite des App-Routers ist
 * (`page`, `layout`, `template`, `default`, `error` ausgenommen) oder deren
 * Komponente `async` ist. Beides kann im Browser nicht laufen.
 *
 * Nicht erkannt wird eine ausgelagerte Komponente ohne `'use client'`, die von
 * einer Server-Seite benutzt wird: Dieselbe Datei kann auch von einer
 * Client-Komponente benutzt werden und ist dann selbst eine. Diese Lücke steht
 * im Guide; der Normalfall einer App — die Liste in `page.tsx` — ist gedeckt.
 */

/** Client-Komponenten aus @openapps/ui, deren Props Funktionen sein können. */
const CLIENT_COMPONENTS = new Set(['Table', 'ListPattern', 'DetailPattern', 'FormPattern']);

/** Dateinamen, die im App-Router ohne `'use client'` nur auf dem Server laufen. */
const SERVER_ENTRY = /(?:^|\/)(?:page|layout|template|default)\.(?:tsx|ts|jsx|js|mjs)$/;

/** AST-Schlüssel, die nach oben zeigen — da nicht hineinlaufen. */
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end']);

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

/** Steht am Anfang der Datei `'use client'`? */
function hasUseClient(program) {
  for (const statement of program.body) {
    if (statement.type !== 'ExpressionStatement') break;
    const expression = statement.expression;
    const value =
      expression.type === 'Literal' && typeof expression.value === 'string'
        ? expression.value
        : null;
    if (value === null) break;
    if (value === 'use client') return true;
  }
  return false;
}

/** Die Variable zu einem Bezeichner, über die Scope-Kette. */
function findVariable(scope, name) {
  let current = scope;
  while (current !== null && current !== undefined) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found !== undefined) return found;
    current = current.upper;
  }
  return undefined;
}

/**
 * Sucht eine Funktion im Wert einer Prop — auch in einem Objekt, einem Array
 * oder hinter einem Bezeichner (`columns={COLUMNS}`).
 */
function findFunction(node, scope, seen, depth) {
  if (node === null || typeof node !== 'object' || depth > 12) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFunction(item, scope, seen, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node.type !== 'string') return null;
  if (seen.has(node)) return null;
  seen.add(node);

  if (FUNCTION_TYPES.has(node.type)) return node;

  /**
   * Was ein Aufruf zurückgibt, entsteht beim Rendern auf dem Server: Über die
   * Grenze geht sein Ergebnis, nicht er selbst. `rows={items.map(toRow)}` ist
   * deshalb in Ordnung, obwohl `toRow` eine Funktion ist. Preis: Gibt ein
   * Aufruf doch Funktionen zurück (`columns={spalten()}`), sieht die Regel das
   * nicht — statisch ist dem nicht beizukommen.
   */
  if (
    node.type === 'CallExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'TaggedTemplateExpression'
  ) {
    return null;
  }

  if (node.type === 'Identifier') {
    const variable = findVariable(scope, node.name);
    if (variable === undefined) return null;
    for (const def of variable.defs) {
      if (def.type === 'FunctionName') return def.node;
      if (def.node.type === 'VariableDeclarator' && def.node.init !== null) {
        const found = findFunction(def.node.init, scope, seen, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const found = findFunction(value, scope, seen, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Steht dieses JSX in einer `async`-Funktion?
 *
 * `async` heißt Server: eine Client-Komponente darf nicht `async` sein.
 */
function insideAsyncFunction(node) {
  let current = node.parent;
  while (current !== undefined && current !== null) {
    if (FUNCTION_TYPES.has(current.type) && current.async === true) return true;
    current = current.parent;
  }
  return false;
}

export const noServerFunctionProps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Eine serverseitig gerenderte Seite darf einer Client-Komponente aus @openapps/ui keine Funktion übergeben (cell, rowKey, onRowActivate, onSubmit …).',
    },
    schema: [],
    messages: {
      functionProp:
        '`{{prop}}` an <{{component}}> enthält eine Funktion, diese Datei rendert aber auf dem Server — React reicht keine Funktion in eine Client-Komponente, der Build bricht. Nimm die serverfähige Form (Spalte mit `field`, `rowKey` als Feldname, Verweis mit `href`) und rechne abgeleitete Werte vorher in die Zeile. Braucht die Seite wirklich einen Rückruf, gehört der Teil in eine eigene Datei mit `\'use client\'`.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    /** Namen aus @openapps/ui, die in dieser Datei benutzt werden. */
    const fromUi = new Set();
    let serverFile = false;
    let useClient = false;

    return {
      Program(node) {
        useClient = hasUseClient(node);
        serverFile = !useClient && SERVER_ENTRY.test(filename.replaceAll('\\', '/'));
      },

      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (source !== '@openapps/ui' && !source.startsWith('@openapps/ui/')) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          fromUi.add(specifier.local.name);
        }
      },

      JSXOpeningElement(node) {
        if (useClient) return;
        if (node.name.type !== 'JSXIdentifier') return;
        const component = node.name.name;
        if (!CLIENT_COMPONENTS.has(component)) return;
        if (!fromUi.has(component)) return;
        if (!serverFile && !insideAsyncFunction(node)) return;

        const scope = sourceCode.getScope(node);
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          if (attribute.value === null) continue;
          const prop = attribute.name.type === 'JSXIdentifier' ? attribute.name.name : '?';
          const found = findFunction(attribute.value, scope, new Set(), 0);
          if (found === null) continue;
          context.report({
            node: found,
            messageId: 'functionProp',
            data: { prop, component },
          });
        }
      },
    };
  },
};
