import { getUser } from '@openapps/sdk';
import { createItem, ItemInput, listItems } from '@/lib/items';

/**
 * GET /api/items — operationId listItems, x-openapps-verb read
 *
 * Kein eigener Login: `getUser` wirft, wenn der Aufruf nicht durch das Gateway
 * kam. Die Rechteprüfung liegt davor, im Gateway — hier wird sie nicht
 * wiederholt und auch nicht umgangen.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await getUser(request.headers);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get('q') ?? undefined;
  const items = await listItems(q);
  return Response.json({ items });
}

/** POST /api/items — operationId createItem, x-openapps-verb write */
export async function POST(request: Request): Promise<Response> {
  try {
    await getUser(request.headers);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = ItemInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  return Response.json(await createItem(parsed.data), { status: 201 });
}
