// Start eines App-Containers im lokalen Betrieb (infra/lokal, ADR 0011).
//
// Der Container laeuft schon, die App noch nicht: Sie wartet, bis die Control
// Plane beim Deploy Env und Startsignal in das gemeinsame Verzeichnis legt
// (src/adapters/lokal). Damit gilt lokal dasselbe wie auf dem Server — eine
// App startet nie mit einer Env, die nicht von der Control Plane kommt, und nie
// vor dem Review-Gate.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const app = process.env.LOKAL_APP ?? '';
if (!/^[a-z][a-z0-9-]{1,40}$/.test(app)) {
  console.error(`app-start: LOKAL_APP fehlt oder ist ungueltig ("${app}")`);
  process.exit(1);
}
const runDir = join(process.env.LOKAL_RUNTIME_DIR ?? '/lokal/run', app);

async function readJson(name) {
  try {
    return JSON.parse(await readFile(join(runDir, name), 'utf8'));
  } catch {
    return null;
  }
}

console.log(`app-start: ${app} wartet auf den Deploy durch die Control Plane`);
let env = null;
for (;;) {
  env = await readJson('env.json');
  const signal = await readJson('deploy.json');
  if (env !== null && signal !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

// Der Pfad ist in den Build gebacken. Weicht der der Control Plane ab, waere
// die App unter ihrem Router kaputt — lieber gar nicht starten.
if (env.OPENAPPS_APP_BASE_PATH !== `/${app}`) {
  console.error(
    `app-start: OPENAPPS_APP_BASE_PATH ist "${env.OPENAPPS_APP_BASE_PATH}", gebaut wurde fuer "/${app}"`,
  );
  process.exit(1);
}

const cwd = join('/repo/standard-apps', app);
console.log(`app-start: ${app} startet`);
const child = spawn(join(cwd, 'node_modules/.bin/next'), ['start', '-p', '3000', '-H', '0.0.0.0'], {
  cwd,
  stdio: 'inherit',
  env: { ...process.env, ...env, PORT: '3000' },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 1));
