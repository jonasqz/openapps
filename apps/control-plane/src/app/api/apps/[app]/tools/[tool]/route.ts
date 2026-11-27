/**
 * `POST /api/apps/:app/tools/:tool` — eine App ruft das Tool einer anderen
 * App (ADR 0020). Nur fuer Apps im Netz der Plattform: Der Pfad steht nicht
 * in der Liste der oeffentlichen Pfade der Forward-Auth, und er nimmt nur die
 * Signatur einer App an, keine Session. Die Pruefkette steht in
 * `lib/app-call.ts`.
 */

import { createHttpInvoker } from '../../../../../../infra/app-tool-invoker';
import { handleAppCall } from '../../../../../../lib/app-call';
import { readEnv } from '../../../../../../lib/env';
import { domainContext } from '../../../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  readonly params: Promise<{ readonly app: string; readonly tool: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const env = readEnv();
  const invoker = createHttpInvoker({ authMasterSecret: env.authMasterSecret });
  return handleAppCall(domainContext(), invoker, request, await params);
}
