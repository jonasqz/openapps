import { COLOR_TOKENS, COLOR_UTILITIES, NON_COLOR_SUFFIXES } from './tokens.js';

/** Ein ganzer Farbwert als Zeichenkette: "#fff", "#1a4fd0". */
const HEX_WHOLE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Ein Hex-Wert in einer CSS-Deklaration: "border: 1px solid #ccc".
 * Absichtlich an eine Farb-Eigenschaft gebunden, damit `href="#abc"` oder eine
 * Kennung wie "#feed" nicht als Farbe gemeldet wird.
 */
const HEX_IN_CSS =
  /\b(?:color|background|background-color|border|border-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|accent-color|caret-color|text-decoration-color|stop-color)\b[^;{}]*:[^;{}]*#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/i;

const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/;

const TOKEN_SET = new Set(COLOR_TOKENS);
const UTILITY_SET = new Set(COLOR_UTILITIES);

/** Varianten (`hover:`, `md:`, `dark:`) und `!` abstreifen. */
function bare(className) {
  const withoutVariants = className.slice(className.lastIndexOf(':') + 1);
  return withoutVariants.replace(/^!/, '');
}

/**
 * Prüft eine Tailwind-Klasse. Gibt den Grund zurück, warum sie verboten ist,
 * oder `null`.
 */
export function checkClass(raw) {
  const className = bare(raw);
  if (className === '') return null;

  // Beliebiger Wert: bg-[#fff], text-[rgb(0,0,0)], bg-[--meine-var]
  const arbitrary = /^([a-z-]+)-\[(.+)]$/.exec(className);
  if (arbitrary !== null && UTILITY_SET.has(arbitrary[1])) {
    return `Eigener Farbwert in "${raw}". Erlaubt sind nur die Tokens aus @openapps/ui.`;
  }

  for (const utility of COLOR_UTILITIES) {
    if (!className.startsWith(`${utility}-`)) continue;
    const suffix = className.slice(utility.length + 1);
    if (suffix === '') continue;
    if (NON_COLOR_SUFFIXES.has(suffix)) continue;
    if (TOKEN_SET.has(suffix)) return null;
    // `border-x-border` o. Ä.: längeres Utility hat Vorrang, weiter suchen.
    if (COLOR_UTILITIES.some((other) => other !== utility && other.startsWith(`${utility}-`) && className.startsWith(`${other}-`))) {
      continue;
    }
    return `Farbklasse "${raw}" steht nicht in den Tokens. Erlaubt: ${utility}-<Token> mit einem Token aus @openapps/ui.`;
  }
  return null;
}

/** Findet rohe Farbwerte in beliebigem Text (Styles, Zeichenketten). */
export function checkRawValue(text) {
  const trimmed = text.trim();
  if (HEX_WHOLE.test(trimmed) || HEX_IN_CSS.test(text)) {
    return `Eigener Hex-Farbwert in "${trimmed.slice(0, 60)}". Nur Farb-Tokens aus @openapps/ui.`;
  }
  if (FUNCTIONAL.test(text)) {
    return `Eigene Farbfunktion in "${trimmed.slice(0, 60)}". Nur Farb-Tokens aus @openapps/ui.`;
  }
  return null;
}

const ATTRIBUTES_WITH_CLASSES = new Set(['className', 'class', 'classList']);

/**
 * Attribute, deren Wert eine Adresse oder Kennung ist. `href="#abc"` ist kein
 * Farbwert, auch wenn „abc" hexadezimal gelesen werden kann.
 */
const ATTRIBUTES_WITH_REFERENCES = new Set([
  'href',
  'src',
  'id',
  'htmlFor',
  'name',
  'to',
  'action',
  'xlinkHref',
  'form',
  'headers',
  'list',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
]);

/** Steht dieses Literal in einem Adress-/Kennungs-Attribut? */
function isReferenceValue(node) {
  const parent = node.parent;
  if (parent === undefined || parent === null) return false;
  if (parent.type === 'JSXAttribute' && parent.name.type === 'JSXIdentifier') {
    return ATTRIBUTES_WITH_REFERENCES.has(parent.name.name);
  }
  if (parent.type === 'TemplateLiteral' || parent.type === 'BinaryExpression') {
    return isReferenceValue(parent);
  }
  return false;
}

/**
 * Blockiert eigene Farbwerte: Hex, `rgb()`/`hsl()`/`oklch()`, beliebige
 * Tailwind-Werte (`bg-[#fff]`) und Tailwind-Farbklassen außerhalb der Tokens.
 *
 * Guide-Regel: „Keine eigenen Farbwerte (kein Hex, kein `rgb()`, keine
 * Tailwind-Farbklasse außerhalb der Tokens)".
 */
export const noRawColor = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Nur Farb-Tokens aus @openapps/ui verwenden — kein Hex, kein rgb()/hsl(), keine fremde Tailwind-Farbklasse.',
    },
    schema: [],
    messages: { forbidden: '{{reason}}' },
  },
  create(context) {
    const report = (node, reason) => {
      if (reason !== null) context.report({ node, messageId: 'forbidden', data: { reason } });
    };

    const checkClassList = (node, value) => {
      for (const part of value.split(/\s+/)) report(node, checkClass(part));
    };

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (isReferenceValue(node)) return;
        report(node, checkRawValue(node.value));
      },
      TemplateElement(node) {
        report(node, checkRawValue(node.value.raw));
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!ATTRIBUTES_WITH_CLASSES.has(name)) return;
        const value = node.value;
        if (value === null) return;
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkClassList(value, value.value);
        } else if (value.type === 'JSXExpressionContainer') {
          const walk = (expression) => {
            if (expression.type === 'Literal' && typeof expression.value === 'string') {
              checkClassList(expression, expression.value);
            } else if (expression.type === 'TemplateLiteral') {
              for (const quasi of expression.quasis) checkClassList(quasi, quasi.value.raw);
            } else if (expression.type === 'CallExpression') {
              for (const argument of expression.arguments) walk(argument);
            } else if (expression.type === 'ArrayExpression') {
              for (const element of expression.elements) if (element !== null) walk(element);
            } else if (expression.type === 'ConditionalExpression') {
              walk(expression.consequent);
              walk(expression.alternate);
            } else if (expression.type === 'LogicalExpression') {
              walk(expression.left);
              walk(expression.right);
            }
          };
          walk(value.expression);
        }
      },
    };
  },
};
