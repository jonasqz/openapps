/**
 * Was als „Liste" gilt.
 *
 * Erkannt wird: `<Table>` aus @openapps/ui, `.map(...)` in JSX, und
 * `<ul>`/`<ol>`, die aus Daten entstehen. Das sind genau die Stellen, an denen
 * ein leerer oder ein Fehlerzustand fehlen kann.
 */
const LIST_COMPONENTS = new Set(['Table', 'ListPattern']);

/** Komponenten, die beide Zustände bereits mitbringen. */
const COMPLETE_PATTERNS = new Set(['ListPattern']);

/**
 * Komponenten, die beide Zustände tragen KÖNNEN, aber nur, wenn sie sie
 * mitbekommen. `Table` hat `empty` und `error` als Props und rendert dann
 * selbst `EmptyState` und `ErrorState` — wer beide setzt, hat die Zustände, und
 * ein zusätzlicher Import wäre unbenutzt. Fehlt eine der beiden Props, ist es
 * eine Liste ohne Zustand und die Regel greift wie vorher.
 */
const SELF_SUFFICIENT_WITH_PROPS = new Map([['Table', ['empty', 'error']]]);

/** Trägt dieses Element alle Props, die es selbst genügen lassen? */
function carriesOwnStates(node, name) {
  const required = SELF_SUFFICIENT_WITH_PROPS.get(name);
  if (required === undefined) return false;
  const present = new Set();
  for (const attribute of node.attributes) {
    if (attribute.type !== 'JSXAttribute') continue;
    if (attribute.name.type !== 'JSXIdentifier') continue;
    // Ein gesetztes `empty={undefined}` zählt nicht: dann gibt es keinen Zustand.
    if (attribute.value === null) continue;
    if (
      attribute.value.type === 'JSXExpressionContainer' &&
      attribute.value.expression.type === 'Identifier' &&
      attribute.value.expression.name === 'undefined'
    ) {
      continue;
    }
    present.add(attribute.name.name);
  }
  return required.every((prop) => present.has(prop));
}

/** JSX-Elemente, deren Kinder eine Datenliste sind. */
const LIST_ELEMENTS = new Set(['ul', 'ol', 'tbody', 'table']);

/** Steht dieser Knoten innerhalb eines Listen-Elements? */
function insideListElement(node) {
  let current = node.parent;
  while (current !== undefined && current !== null) {
    if (current.type === 'JSXElement') {
      const name = current.openingElement.name;
      if (name.type === 'JSXIdentifier' && LIST_ELEMENTS.has(name.name)) return true;
    }
    current = current.parent;
  }
  return false;
}

const EMPTY_IMPORTS = new Set(['EmptyState']);
const ERROR_IMPORTS = new Set(['ErrorState']);

/**
 * Verlangt, dass eine Datei mit einer Liste den leeren und den Fehlerzustand
 * aus `@openapps/ui` importiert.
 *
 * Guide-Regel: „Jede Liste hat leeren und Fehlerzustand (ja — Muster-Import
 * erforderlich)". Der Linter prüft den Import, nicht das Verhalten zur
 * Laufzeit — mehr ist statisch nicht zu belegen, und das steht so im Guide.
 *
 * `ListPattern` zählt als beides, weil es beide Zustände in sich trägt. Eine
 * `<Table>` mit `empty` und `error` ebenso — sie rendert beide selbst, und ein
 * zusätzlicher Import wäre toter Code.
 */
export const requireListStates = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Jede Liste braucht einen leeren und einen Fehlerzustand aus @openapps/ui (EmptyState und ErrorState, oder ListPattern).',
    },
    schema: [],
    messages: {
      missing:
        'Diese Datei zeigt eine Liste, importiert aber {{missing}} nicht aus @openapps/ui. Jede Liste braucht einen leeren und einen Fehlerzustand (oder nimm ListPattern).',
    },
  },
  create(context) {
    let hasEmpty = false;
    let hasError = false;
    /** @type {{ node: unknown } | null} */
    let firstList = null;

    const noteList = (node) => {
      if (firstList === null) firstList = node;
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@openapps/ui' && !String(node.source.value).startsWith('@openapps/ui/')) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const name = specifier.imported.type === 'Identifier' ? specifier.imported.name : '';
          if (EMPTY_IMPORTS.has(name)) hasEmpty = true;
          if (ERROR_IMPORTS.has(name)) hasError = true;
          if (COMPLETE_PATTERNS.has(name)) {
            hasEmpty = true;
            hasError = true;
          }
        }
      },

      JSXOpeningElement(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!LIST_COMPONENTS.has(name)) return;
        if (carriesOwnStates(node, name)) return;
        noteList(node);
      },

      'JSXExpressionContainer > CallExpression'(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'map'
        ) {
          return;
        }
        // Nur ein `.map` IN einem Listen-Element ist eine Liste. Ein `.map`
        // über Reiter, Felder oder Meldungen ist keine und braucht keinen
        // leeren Zustand — sonst meldet der Linter Dinge, die niemand meint.
        if (insideListElement(node)) noteList(node);
      },

      'Program:exit'() {
        if (firstList === null) return;
        if (hasEmpty && hasError) return;
        const missing = [];
        if (!hasEmpty) missing.push('EmptyState');
        if (!hasError) missing.push('ErrorState');
        context.report({
          node: firstList,
          messageId: 'missing',
          data: { missing: missing.join(' und ') },
        });
      },
    };
  },
};
