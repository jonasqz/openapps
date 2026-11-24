// Erzeugt docker-compose.apps.yml: ein Dienst je App in standard-apps/
// (ADR 0011, ADR 0015). Laeuft vor jedem Compose-Aufruf ueber lokal.sh, damit
// eine neue App ohne Handgriff einen Container bekommt.
//
// Jeder Dienst baut sein eigenes Image (app.Dockerfile mit LOKAL_APP), traegt
// den Netz-Alias openapps-<app>, den die Control Plane im Router und der MCP
// beim Aufruf benutzen, und hat weder Ports noch Traefik-Labels: erreichbar
// nur ueber den Router, den die Control Plane schreibt.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appsDir = join(here, '../../standard-apps');
const NAME = /^[a-z][a-z0-9-]{1,40}$/;

const names = [];
for (const entry of (await readdir(appsDir, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!entry.isDirectory()) continue;
  try {
    const manifest = JSON.parse(await readFile(join(appsDir, entry.name, 'app.json'), 'utf8'));
    if (manifest.name !== entry.name) {
      console.warn(`apps-dienste: ${entry.name}/app.json heisst "${manifest.name}", uebersprungen`);
      continue;
    }
  } catch {
    continue; // kein app.json: keine App
  }
  if (!NAME.test(entry.name)) {
    console.warn(`apps-dienste: "${entry.name}" ist kein gueltiger App-Name, uebersprungen`);
    continue;
  }
  names.push(entry.name);
}

const service = (name) => `  app-${name}:
    build:
      context: ../..
      dockerfile: infra/lokal/app.Dockerfile
      args: { LOKAL_APP: ${name} }
    restart: unless-stopped
    depends_on:
      init:
        condition: service_completed_successfully
    environment: { LOKAL_APP: ${name} }
    volumes:
      - lokal-run:/lokal/run:ro
    networks:
      plattform:
        aliases: [openapps-${name}]
`;

const yaml = `# Erzeugt von apps-dienste.mjs, nicht von Hand aendern und nicht committen.
# Eine App kommt dazu, indem es standard-apps/<name>/app.json gibt.
services:
${names.length === 0 ? '  {}\n' : names.map(service).join('\n')}`;

await writeFile(join(here, 'docker-compose.apps.yml'), yaml);
console.log(`apps-dienste: ${names.length} App(s): ${names.join(', ') || '-'}`);
