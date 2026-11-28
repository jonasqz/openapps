import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * tsconfig sagt `jsx: preserve` (Next uebersetzt selbst). Fuer die Tests
 * uebersetzt esbuild JSX mit der automatischen Runtime, und `@/` zeigt wie in
 * tsconfig auf `src/`.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    // Die Datenbank-Tests (`*.db.test.ts`) teilen sich ein Schema und raeumen
    // es je Test auf. Mit Datenbank laufen die Dateien deshalb nacheinander.
    fileParallelism: (process.env.KNOWLEDGE_TEST_DATABASE_URL ?? '') === '',
  },
});
