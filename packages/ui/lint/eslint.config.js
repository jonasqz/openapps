/**
 * Der UI-Linter von openapps.
 *
 * Eine App bindet ihn so ein (`eslint.config.js` der App):
 *
 *   import openappsUi from '@openapps/ui/eslint-config';
 *   export default [...openappsUi];
 *
 * Er läuft außerdem im Review-Gate (`request_deploy`). Was er blockiert, steht
 * in `docs/05-ui-guide.md` in der Spalte „prüft der Linter: ja".
 */
import tsParser from '@typescript-eslint/parser';
import { plugin } from './rules/index.js';

/** Die drei Regeln, die der Guide als „ja" führt. */
export const rules = {
  '@openapps/ui/no-raw-color': 'error',
  '@openapps/ui/no-foreign-ui': 'error',
  '@openapps/ui/require-list-states': 'error',
  '@openapps/ui/require-form-states': 'error',
};

/** Die Regeln für App-Code — fertig zum Spreaden in eine Flat Config. */
export const openappsUiConfig = [
  {
    name: '@openapps/ui/ignores',
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.css'],
  },
  {
    name: '@openapps/ui/app-code',
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { '@openapps/ui': plugin },
    rules,
  },
  {
    /**
     * Konfigurationsdateien dürfen das Preset importieren und Tailwind-Namen
     * nennen, ohne als App-Code zu gelten.
     */
    name: '@openapps/ui/config-files',
    files: ['**/tailwind.config.{js,ts,mjs}', '**/postcss.config.{js,ts,mjs}', '**/next.config.{js,ts,mjs}'],
    rules: {
      '@openapps/ui/no-foreign-ui': 'off',
    },
  },
  {
    /**
     * Testdateien dürfen ihr Test-Framework und Test-Hilfen importieren. Die
     * Regel zielt auf App-Code: ein Test-Runner ist keine zweite
     * UI-Bibliothek, und jede App braucht einen. Die Farb- und
     * Zustandsregeln gelten in Tests weiter — ein Test, der eine Liste
     * rendert, soll ihre Zustände zeigen wie der Code selbst.
     */
    name: '@openapps/ui/test-files',
    files: [
      '**/*.{test,spec}.{ts,tsx,js,jsx,mjs}',
      '**/tests/**/*.{ts,tsx,js,jsx,mjs}',
      '**/__tests__/**/*.{ts,tsx,js,jsx,mjs}',
      '**/vitest.config.{ts,js,mjs}',
      '**/*.setup.{ts,js,mjs}',
    ],
    rules: {
      '@openapps/ui/no-foreign-ui': 'off',
    },
  },
];

export default openappsUiConfig;
