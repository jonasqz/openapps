import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appManifestJsonSchema } from '../json-schema.js';

// dist/bin/write-json-schema.js -> Paketwurzel
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = resolve(packageRoot, 'schema', 'app.schema.json');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(appManifestJsonSchema(), null, 2)}\n`, 'utf8');

process.stdout.write(`app.schema.json geschrieben: ${target}\n`);
