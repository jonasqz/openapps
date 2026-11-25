import { ToolNotFoundError } from '@openapps/sdk';
import { query } from './db';
import type { AufgabeCreateArgs, AufgabenListArgs } from './schemas';

export interface Aufgabe {
  id: string;
  titel: string;
  zustaendig: string;
  /** JJJJ-MM-TT oder null. */
  faelligAm: string | null;
  erledigt: boolean;
  erledigtAm: string | null;
  erledigtVon: string | null;
  erstelltVon: string;
  erstelltAm: string;
}

interface AufgabeRow extends Record<string, unknown> {
  id: string;
  titel: string;
  zustaendig: string;
  faellig_am: string | null;
  erledigt: boolean;
  erledigt_am: Date | null;
  erledigt_von: string | null;
  erstellt_von: string;
  erstellt_am: Date;
}

/** Datum als Text aus der DB holen, damit keine Zeitzone es verschiebt. */
const COLUMNS = `id, titel, zustaendig, to_char(faellig_am, 'YYYY-MM-DD') as faellig_am,
  erledigt, erledigt_am, erledigt_von, erstellt_von, erstellt_am`;

const toAufgabe = (row: AufgabeRow): Aufgabe => ({
  id: row.id,
  titel: row.titel,
  zustaendig: row.zustaendig,
  faelligAm: row.faellig_am,
  erledigt: row.erledigt,
  erledigtAm: row.erledigt_am?.toISOString() ?? null,
  erledigtVon: row.erledigt_von,
  erstelltVon: row.erstellt_von,
  erstelltAm: row.erstellt_am.toISOString(),
});

/** Offene zuerst, dann nach Fälligkeit (ohne Datum zuletzt), dann neueste. */
export async function listAufgaben(args: AufgabenListArgs = {}): Promise<Aufgabe[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.erledigt !== undefined) {
    params.push(args.erledigt);
    where.push(`erledigt = $${params.length}`);
  }
  if (args.zustaendig !== undefined) {
    params.push(args.zustaendig);
    where.push(`lower(zustaendig) = lower($${params.length})`);
  }
  params.push(args.limit ?? 50);
  const rows = await query<AufgabeRow>(
    `select ${COLUMNS} from aufgaben
     ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
     order by erledigt, faellig_am nulls last, erstellt_am desc
     limit $${params.length}`,
    params,
  );
  return rows.map(toAufgabe);
}

export async function createAufgabe(input: AufgabeCreateArgs, erstelltVon: string): Promise<Aufgabe> {
  const rows = await query<AufgabeRow>(
    `insert into aufgaben (titel, zustaendig, faellig_am, erstellt_von)
     values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [input.titel, input.zustaendig, input.faelligAm ?? null, erstelltVon],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert returned no row');
  return toAufgabe(row);
}

/** Setzt erledigt. Ist die Aufgabe schon erledigt, ändert sich nichts. */
export async function erledigeAufgabe(
  id: string,
  von: string,
): Promise<{ aufgabe: Aufgabe; changed: boolean }> {
  const updated = await query<AufgabeRow>(
    `update aufgaben set erledigt = true, erledigt_am = now(), erledigt_von = $2
     where id = $1 and not erledigt returning ${COLUMNS}`,
    [id, von],
  );
  if (updated[0] !== undefined) return { aufgabe: toAufgabe(updated[0]), changed: true };

  const existing = await query<AufgabeRow>(`select ${COLUMNS} from aufgaben where id = $1`, [id]);
  if (existing[0] === undefined) {
    throw new ToolNotFoundError(`Keine Aufgabe mit id ${id}. Die id kommt aus aufgaben.list.`);
  }
  return { aufgabe: toAufgabe(existing[0]), changed: false };
}
