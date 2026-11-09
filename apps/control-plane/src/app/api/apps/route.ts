/**
 * `GET /api/apps` und `POST /api/apps`.
 *
 * Diese Handler enthalten keine Logik. Sie bestimmen den Aufrufer, rufen die
 * Domaenenfunktion und bilden Fehler ab — nichts sonst. Dieselben Funktionen
 * ruft der Plattform-MCP, damit Tool und Endpunkt nie auseinanderlaufen.
 */

import { createApp, listApps } from '../../../domain';
import type { AppManifest, ManifestSource } from '../../../domain/types';
import { currentActor } from '../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../lib/http';
import { domainContext } from '../../../lib/runtime';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const apps = await listApps(domainContext(), { actor });
    return jsonResponse({ apps });
  } catch (error) {
    return errorResponse(error);
  }
}

interface CreateAppBody {
  readonly name?: string;
  readonly displayName?: string;
  readonly manifest?: AppManifest;
  /** Nur fuer ein bestehendes Repo; ohne Angabe legt die Control Plane eines an. */
  readonly source?: ManifestSource;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const body = await readJson<CreateAppBody>(request);
    if (body.name === undefined || body.manifest === undefined) {
      return jsonResponse(
        { error: 'validation_failed', message: 'name und manifest sind nötig' },
        422,
      );
    }
    const app = await createApp(domainContext(), {
      actor,
      name: body.name,
      manifest: body.manifest,
      ...(body.source === undefined ? {} : { source: body.source }),
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    });
    return jsonResponse({ app }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
