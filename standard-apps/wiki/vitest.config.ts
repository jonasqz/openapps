import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `tsconfig.json` sagt `jsx: preserve` (Next uebersetzt selbst). Fuer die Tests
 * uebersetzt esbuild JSX mit der automatischen Runtime, und `@/` zeigt wie in
 * Next auf `src/`.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
