/** `POST /api/apps/:app/deploys` — Deploy anfragen. Laeuft immer durch das Gate. */

import { listDeployments, requestDeploy } from '../../../../../domain';
import type { CodeFacts } from '../../../../../domain/review-gate/types';
import type { AppManifest } from '../../../../../domain/types';
import { currentActor } from '../../../../../lib/actor';
import { errorResponse, jsonResponse, readJson } from '../../../../../lib/http';
import { domainContext } from '../../../../../lib/runtime';

interface RouteParams {
  readonly params: Promise<{ readonly app: string }>;
}

interface DeployBody {
  readonly manifest?: AppManifest;
  readonly version?: string;
  readonly gitSha?: string;
  readonly repoDir?: string;
  readonly uiActions?: readonly string[];
  readonly codeFacts?: CodeFacts;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { app } = await params;
    const deployments = await listDeployments(domainContext(), { actor, appIdOrName: app });
    return jsonResponse({ deployments });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const actor = await currentActor(request);
    const { app } = await params;
    const body = await readJson<DeployBody>(request);
    if (body.version === undefined || body.gitSha === undefined || body.repoDir === undefined) {
      return jsonResponse(
        { error: 'validation_failed', message: 'version, gitSha und repoDir sind nötig' },
        422,
      );
    }
    const outcome = await requestDeploy(domainContext(), {
      actor,
      appIdOrName: app,
      version: body.version,
      gitSha: body.gitSha,
      repoDir: body.repoDir,
      ...(body.manifest === undefined ? {} : { manifest: body.manifest }),
      ...(body.uiActions === undefined ? {} : { uiActions: body.uiActions }),
      ...(body.codeFacts === undefined ? {} : { codeFacts: body.codeFacts }),
    });
    return jsonResponse(outcome, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
