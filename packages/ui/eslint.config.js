/**
 * Der Linter prüft dieses Paket selbst mit seinen eigenen Regeln.
 *
 * Zwei Ausnahmen: `src/tokens/tokens.ts` IST die Farbquelle, und das Paket darf
 * sich selbst relativ importieren.
 */
import openappsUiConfig from './lint/eslint.config.js';

export default [
  ...openappsUiConfig,
  {
    name: 'ui/tokens-quelle',
    files: [
      'src/tokens/tokens.ts',
      'src/tokens/generate.ts',
      'src/tokens/contrast.ts',
      'src/tokens/*.test.ts',
      // Die Regeln und ihre Tests müssen die verbotenen Muster nennen dürfen.
      'lint/**/*.js',
      'lint/test/**/*.ts',
    ],
    rules: { '@openapps/ui/no-raw-color': 'off' },
  },
  {
    name: 'ui/eigene-tests-und-showcase',
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts', 'showcase/**/*.{ts,tsx}', 'lint/**/*.js'],
    rules: { '@openapps/ui/no-foreign-ui': 'off' },
  },
  {
    /**
     * `require-list-states` und `require-form-states` prüfen, dass APP-Code
     * die Zustände und das Formular-Muster aus `@openapps/ui` importiert.
     * Dieses Paket IST ihre Quelle und importiert sie relativ (auch das
     * Schaufenster) — die Regeln können hier nichts Sinnvolles sagen.
     * `FormPattern` selbst wäre sonst der erste Verstoß gegen
     * `require-form-states`.
     */
    name: 'ui/eigene-listen-und-formulare',
    files: ['src/**/*.tsx', 'showcase/**/*.tsx'],
    rules: {
      '@openapps/ui/require-list-states': 'off',
      '@openapps/ui/require-form-states': 'off',
    },
  },
];
