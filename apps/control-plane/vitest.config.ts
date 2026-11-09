import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Die Tests laufen ohne Datenbank und ohne Netz. Was echte Infrastruktur
    // braucht, steht als `it.todo` in den Specs.
    globals: false,
    // Die Tests gegen Postgres (`*-postgres.spec.ts`) teilen **eine**
    // Datenbank und setzen sie jeweils auf einen bekannten Stand zurueck.
    // Parallel laufende Dateien wuerden sich dabei gegenseitig die Schemata
    // unter den Fuessen wegziehen. Die Suite ist klein genug, dass das
    // sequenzielle Laufen nicht auffaellt.
    fileParallelism: false,
  },
});
