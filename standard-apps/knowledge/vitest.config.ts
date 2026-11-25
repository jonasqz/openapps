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
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'] },
});
