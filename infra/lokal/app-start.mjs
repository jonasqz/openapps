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
  console.error(`app-start: LOKAL_APP is missing or invalid ("${app}")`);
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

console.log(`app-start: ${app} is waiting for the control plane to deploy it`);

async function waitForDeploy(previousSignal) {
  for (;;) {
    const env = await readJson('env.json');
    const signal = await readJson('deploy.json');
    const signalText = signal === null ? null : JSON.stringify(signal);
    if (env !== null && signalText !== null && signalText !== previousSignal) {
      return { env, signalText };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const cwd = join('/repo/standard-apps', app);
let child = null;
let stopping = false;

function start(env) {
  // Der Pfad ist in den Build gebacken. Weicht der der Control Plane ab, waere
  // die App unter ihrem Router kaputt — lieber gar nicht starten.
  if (env.OPENAPPS_APP_BASE_PATH !== `/${app}`) {
    console.error(
      `app-start: OPENAPPS_APP_BASE_PATH is "${env.OPENAPPS_APP_BASE_PATH}", but the build is for "/${app}"`,
    );
    process.exit(1);
  }
  console.log(`app-start: ${app} is starting`);
  const started = spawn(
    join(cwd, 'node_modules/.bin/next'),
    ['start', '-p', '3000', '-H', '0.0.0.0'],
    {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env, PORT: '3000' },
    },
  );
  started.on('exit', (code) => {
    // Ein Neustart nach einem Deploy beendet das Kind absichtlich.
    if (started.restarting !== true) process.exit(code ?? 1);
  });
  return started;
}

function stop(running) {
  return new Promise((resolve) => {
    running.restarting = true;
    running.once('exit', resolve);
    running.kill('SIGTERM');
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    if (child === null) process.exit(0);
    child.kill(sig);
  });
}

// Jeder Deploy schreibt ein neues Startsignal. Der Container laeuft oft schon
// mit dem Stand des letzten Deploys, wenn die Control Plane die Env nachzieht
// (ADR 0020): Dann startet die App mit der neuen Env neu, wie auf dem Server.
let signalText = null;
while (!stopping) {
  const next = await waitForDeploy(signalText);
  signalText = next.signalText;
  if (child !== null) {
    console.log(`app-start: ${app} got a new deploy, restarting`);
    await stop(child);
  }
  if (stopping) break;
  child = start(next.env);
}
