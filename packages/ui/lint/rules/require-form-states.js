/** Felder aus @openapps/ui, die in ein Formular gehören. */
const FIELD_COMPONENTS = new Set(['Input', 'Select', 'Checkbox', 'FieldShell']);

/** Das Muster, das die sichtbare Fehlermeldung am Feld mitbringt. */
const FORM_PATTERN = 'FormPattern';

/**
 * Attribute, die aus einem Feld-Verbund einen Absende-Pfad machen — auch ohne
 * `<form>`: ein Knopf, der speichert, ist ein Absende-Pfad.
 */
const SUBMIT_HINTS = /^(onSubmit|onSave|onCreate|onUpdate)$/;

/**
 * Verlangt, dass eine Datei mit einem Formular `FormPattern` aus
 * `@openapps/ui` importiert.
 *
 * Guide-Regel: „Jedes Formular zeigt Validierungsfehler sichtbar am Feld —
 * ja (Muster-Import `FormPattern` erforderlich)."
 *
 * Warum der Muster-Import und nicht „hat eine Fehlermeldung": eine Regel, die
 * nur das Vorhandensein einer `error`-Prop prüft, lässt sich mit einem leeren
 * String austricksen. `FormPattern` bringt Validierung, `aria-invalid`,
 * `aria-describedby`, `role="alert"` und die Fehlerzusammenfassung mit — das
 * ist prüfbar und nicht auszuhebeln.
 *
 * Als Formular gilt:
 *  - ein `<form>` mit mindestens einem Feld darin, oder
 *  - zwei oder mehr Felder aus @openapps/ui zusammen mit einem Absende-Pfad
 *    (`onSubmit`/`onSave`/… oder ein Knopf mit `type="submit"`).
 *
 * Ein einzelnes Suchfeld oder ein Filter ist damit **kein** Formular und
 * braucht `FormPattern` nicht — sonst würde die Regel jede Liste melden.
 */
export const requireFormStates = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Jedes Formular nutzt FormPattern aus @openapps/ui — damit ist die Validierung sichtbar am Feld.',
    },
    schema: [],
    messages: {
      missing:
        'Diese Datei baut ein Formular, importiert aber FormPattern nicht aus @openapps/ui. Jedes Formular zeigt Validierungsfehler sichtbar am Feld — FormPattern bringt das mit.',
    },
  },
  create(context) {
    let hasFormPattern = false;
    let fieldCount = 0;
    let hasSubmitPath = false;
    let firstForm = null;
    let firstField = null;
    let formWithField = null;

    const note = (slot, node) => (slot === null ? node : slot);

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (source !== '@openapps/ui' && !source.startsWith('@openapps/ui/')) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const name = specifier.imported.type === 'Identifier' ? specifier.imported.name : '';
          if (name === FORM_PATTERN) hasFormPattern = true;
        }
      },

      JSXOpeningElement(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';

        if (name === 'form') {
          firstForm = note(firstForm, node);
          hasSubmitPath = true;
        }

        if (FIELD_COMPONENTS.has(name) || name === 'input' || name === 'textarea') {
          fieldCount += 1;
          firstField = note(firstField, node);
          // Steht das Feld in einem <form>? Dann ist es sicher ein Formular.
          let current = node.parent;
          while (current !== undefined && current !== null) {
            if (
              current.type === 'JSXElement' &&
              current.openingElement.name.type === 'JSXIdentifier' &&
              current.openingElement.name.name === 'form'
            ) {
              formWithField = note(formWithField, node);
              break;
            }
            current = current.parent;
          }
        }

        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          const attributeName =
            attribute.name.type === 'JSXIdentifier' ? attribute.name.name : '';
          if (SUBMIT_HINTS.test(attributeName)) hasSubmitPath = true;
          if (
            attributeName === 'type' &&
            attribute.value !== null &&
            attribute.value.type === 'Literal' &&
            attribute.value.value === 'submit'
          ) {
            hasSubmitPath = true;
          }
        }
      },

      'Program:exit'() {
        if (hasFormPattern) return;
        const isForm = formWithField !== null || (fieldCount >= 2 && hasSubmitPath);
        if (!isForm) return;
        context.report({ node: formWithField ?? firstForm ?? firstField, messageId: 'missing' });
      },
    };
  },
};
