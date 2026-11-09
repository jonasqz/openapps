import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Die Tests laufen ohne Datenbank und ohne Netz. Was echte Infrastruktur
    // braucht, steht als `it.todo` in den Specs.
    globals: false,
  },
});
