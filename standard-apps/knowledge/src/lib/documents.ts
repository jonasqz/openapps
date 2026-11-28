import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { chunkText } from './chunk';
import { query, withTransaction, type QueryFn } from './db';
import { kickEmbeddings } from './knowledge-runtime';
import type { DocumentInput, GetArgs, ListArgs, RemoveArgs, UpsertArgs } from './schemas';
import { sourceUrlFor, visibleSourceApps, type Visibility } from './visibility';

/**
 * Die Fachlogik hinter den Tools `documents.*`. Kein Auth- und kein
 * Rechte-Code: Wer hier ankommt, hat das Gateway oder die Plattform
 * passiert. `createdBy` ist nur die Identitaet fuer die Spalte, keine Pruefung.
 *
 * Sichtbarkeit (ADR 0020): Jede lesende Funktion nimmt eine `Visibility`
 * als Pflichtargument. Die Liste der lesbaren Apps kommt signiert von der
 * Plattform; hier wird sie nur in die Abfrage gesetzt.
 */

export interface DocumentSummary {
  id: string;
  title: string;
  source: string | null;
  /** App, aus der das Dokument kommt. `null`: in Knowledge angelegt. */
  sourceApp: string | null;
  /** Schluessel in der Quell-App. */
  sourceKey: string | null;
  /** Pfad in der Quell-App fuer den Link zurueck. */
  sourcePath: string | null;
  /** Adresse zurueck zur Quelle, falls bekannt. */
  sourceUrl: string | null;
  charCount: number;
  chunkCount: number;
  createdBy: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
}

export interface Chunk {
  id: string;
  ord: number;
  text: string;
}

interface DocumentRow extends Record<string, unknown> {
  id: string;
  title: string;
  source: string | null;
  source_app: string | null;
  source_key: string | null;
  source_path: string | null;
  char_count: number;
  chunk_count: number;
  created_by: string;
  created_at: Date;
}

const toSummary = (row: DocumentRow): DocumentSummary => ({
  id: row.id,
  title: row.title,
  source: row.source,
  sourceApp: row.source_app,
  sourceKey: row.source_key,
  sourcePath: row.source_path,
  sourceUrl: sourceUrlFor(row.source_app, row.source_path),
  charCount: Number(row.char_count),
  chunkCount: Number(row.chunk_count),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const SUMMARY_COLUMNS = `
  d.id::text as id, d.title, d.source, d.source_app, d.source_key, d.source_path,
  d.char_count, d.created_by, d.created_at,
  (select count(*)::int from chunks c where c.document_id = d.id) as chunk_count`;

/** Legt die Abschnitte eines Dokuments an. Nur innerhalb einer Transaktion aufrufen. */
async function insertChunks(tx: QueryFn, documentId: string, chunks: readonly string[]) {
  await tx(
    `insert into chunks (document_id, ord, text)
     select $1::uuid, (u.n - 1)::int, u.t
       from unnest($2::text[]) with ordinality as u(t, n)`,
    [documentId, [...chunks]],
  );
}

/**
 * So weit schiebt `replaceChunks` die alten Abschnitte, bevor es die neue
 * Reihenfolge setzt. Ein Dokument hat hoechstens einige hundert Abschnitte.
 */
const ORD_SHIFT = 1_000_000;

/**
 * Ersetzt die Abschnitte eines Dokuments, **behaelt aber jeden Abschnitt,
 * dessen Text gleich geblieben ist** (mit Id und Vektoren, ADR 0025). Ein
 * Wiki speichert oft nur einen Absatz neu; ohne das wuerde jedes Speichern
 * das ganze Dokument noch einmal einbetten und das Tagesbudget aufbrauchen.
 * Nur innerhalb einer Transaktion aufrufen.
 *
 * 1. Alle alten Abschnitte aus dem Weg schieben (`ord + ORD_SHIFT`).
 * 2. In einer Anweisung: gleichen Text (je Vorkommen, `k`) auf die neue
 *    Position setzen, den Rest neu anlegen. Die Positionen sind getrennt,
 *    also verletzt keine Zeile `chunks_document_ord_key`.
 * 3. Was noch verschoben ist, wird nicht mehr gebraucht. Seine Vektoren
 *    gehen mit (`on delete cascade`).
 */
async function replaceChunks(tx: QueryFn, documentId: string, chunks: readonly string[]) {
  await tx('update chunks set ord = ord + $2 where document_id = $1::uuid', [
    documentId,
    ORD_SHIFT,
  ]);
  await tx(
    `with wanted as (
       select u.t as text, (u.n - 1)::int as ord,
              row_number() over (partition by u.t order by u.n) as k
         from unnest($2::text[]) with ordinality as u(t, n)
     ),
     old as (
       select id, text, row_number() over (partition by text order by ord) as k
         from chunks where document_id = $1::uuid
     ),
     kept as (
       update chunks c set ord = w.ord
         from wanted w join old o on o.text = w.text and o.k = w.k
        where c.id = o.id
       returning c.id
     )
     insert into chunks (document_id, ord, text)
     select $1::uuid, w.ord, w.text
       from wanted w
      where not exists (select 1 from old o where o.text = w.text and o.k = w.k)`,
    [documentId, [...chunks]],
  );
  await tx('delete from chunks where document_id = $1::uuid and ord >= $2', [
    documentId,
    ORD_SHIFT,
  ]);
}

/** `documents.add`: Dokument und Abschnitte in einer Transaktion. */
export async function addDocument(
  input: DocumentInput,
  createdBy: string,
): Promise<{ id: string; chunkCount: number }> {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    // Das Schema laesst keinen leeren Text durch; das hier ist die zweite Huerde.
    throw new ToolInputError('content contains no text');
  }
  const created = await withTransaction(async (tx) => {
    const rows = await tx<{ id: string }>(
      `insert into documents (title, source, content, char_count, created_by)
       values ($1, $2, $3, char_length($3), $4)
       returning id::text as id`,
      [input.title, input.source, input.content, createdBy],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert into documents returned no row');
    await insertChunks(tx, id, chunks);
    return { id, chunkCount: chunks.length };
  });
  // Nach dem Commit, ohne zu warten: Speichern scheitert nie am Modell.
  kickEmbeddings();
  return created;
}

/** `%` und `_` sind in `ilike` Platzhalter; aus der Eingabe gelten sie woertlich. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Die Bedingung fuer sichtbare Dokumente: ohne Quell-App, oder mit einer
 * Quell-App aus der Liste. `$n` ist ein `text[]`; leer heisst nur eigene.
 */
const visibleIn = (param: string): string =>
  `(d.source_app is null or d.source_app = any(${param}::text[]))`;

/** `documents.list`: neueste zuerst, hoechstens 200, ohne Volltext, nur Sichtbares. */
export async function listDocuments(
  args: ListArgs,
  visibility: Visibility,
): Promise<DocumentSummary[]> {
  const q = args.q?.trim() ?? '';
  const apps = visibleSourceApps(visibility);
  const rows =
    q === ''
      ? await query<DocumentRow>(
          `select ${SUMMARY_COLUMNS} from documents d
            where d.deleted_at is null
              and ${visibleIn('$1')}
            order by d.created_at desc, d.title
            limit 200`,
          [apps],
        )
      : await query<DocumentRow>(
          `select ${SUMMARY_COLUMNS} from documents d
            where d.deleted_at is null
              and ${visibleIn('$2')}
              and (d.title ilike $1 escape '\\' or d.source ilike $1 escape '\\')
            order by d.created_at desc, d.title
            limit 200`,
          [`%${escapeLike(q)}%`, apps],
        );
  return rows.map(toSummary);
}

/**
 * `documents.get`: wirft `ToolNotFoundError` fuer unbekannte, geloeschte und
 * nicht sichtbare Dokumente — dieselbe Antwort, damit ein Aufrufer nicht
 * erfaehrt, dass es ein Dokument gibt, das er nicht sehen darf.
 */
export async function getDocument(
  args: GetArgs,
  visibility: Visibility,
): Promise<{ document: DocumentDetail; chunks?: Chunk[] }> {
  const rows = await query<DocumentRow & { content: string }>(
    `select ${SUMMARY_COLUMNS}, d.content from documents d
      where d.id = $1::uuid and d.deleted_at is null
        and ${visibleIn('$2')}`,
    [args.id, visibleSourceApps(visibility)],
  );
  const row = rows[0];
  if (row === undefined) throw new ToolNotFoundError(`Document ${args.id} does not exist`);
  const document: DocumentDetail = { ...toSummary(row), content: row.content };
  if (!args.includeChunks) return { document };

  const chunks = await query<{ id: string; ord: number; text: string }>(
    'select id::text as id, ord, text from chunks where document_id = $1::uuid order by ord',
    [args.id],
  );
  return {
    document,
    chunks: chunks.map((chunk) => ({ id: chunk.id, ord: Number(chunk.ord), text: chunk.text })),
  };
}

/**
 * `documents.delete`: weich. Ein zweites Loeschen ergibt 404, nicht still
 * Erfolg. Dokumente einer Quell-App werden hier nicht geloescht: Sie gehoeren
 * der Quelle, und deren naechster Stand braechte sie zurueck. Entfernt werden
 * sie in der Quell-App (`documents.remove`).
 */
export async function deleteDocument(id: string): Promise<{ id: string; deleted: true }> {
  const owned = await query<{ source_app: string }>(
    `select source_app from documents
      where id = $1::uuid and deleted_at is null and source_app is not null`,
    [id],
  );
  const owner = owned[0]?.source_app;
  if (owner !== undefined) {
    throw new ToolInputError(
      `Document ${id} comes from the app "${owner}" and is kept up to date by it. Remove or archive it there.`,
    );
  }
  const rows = await query<{ id: string }>(
    `update documents set deleted_at = now()
      where id = $1::uuid and deleted_at is null and source_app is null
      returning id::text as id`,
    [id],
  );
  if (rows[0] === undefined) {
    throw new ToolNotFoundError(`Document ${id} does not exist or has already been deleted`);
  }
  return { id, deleted: true };
}

export type UpsertStatus = 'created' | 'updated' | 'stale';

export interface UpsertResult {
  id: string;
  key: string;
  status: UpsertStatus;
  chunkCount: number;
}

/**
 * `documents.upsert`: legt das Dokument der Quell-App `sourceApp` mit dem
 * Schluessel `args.key` an oder ersetzt es, samt Abschnitten, in einer
 * Transaktion.
 *
 * `sourceApp` kommt **nie** aus den Argumenten, sondern aus der gepruefte
 * Identitaet des Aufrufers (`ctx.caller`, siehe `tools.ts`). Der Konflikt
 * zielt auf das Paar (Quell-App, Schluessel): Eine App kann so nur ihre
 * eigenen Dokumente treffen.
 *
 * Ist `updatedAt` aelter als der gespeicherte Stand, bleibt alles, wie es ist
 * (`status: 'stale'`): Eine verspaetete Wiederholung ueberschreibt keinen
 * neueren Stand.
 */
export async function upsertSourceDocument(
  args: UpsertArgs,
  sourceApp: string,
  createdBy: string,
): Promise<UpsertResult> {
  const chunks = chunkText(args.content);
  if (chunks.length === 0) throw new ToolInputError('content contains no text');

  const result = await withTransaction(async (tx) => {
    const rows = await tx<{ id: string; inserted: boolean }>(
      `insert into documents
         (title, source, content, char_count, created_by,
          source_app, source_key, source_path, source_updated_at)
       values ($1, $2, $3, char_length($3), $4, $5, $6, $7, $8::timestamptz)
       on conflict (source_app, source_key) where source_app is not null
       do update set title = excluded.title,
                     source = excluded.source,
                     content = excluded.content,
                     char_count = excluded.char_count,
                     source_path = excluded.source_path,
                     source_updated_at = excluded.source_updated_at,
                     deleted_at = null
        where documents.source_updated_at is null
           or excluded.source_updated_at is null
           or excluded.source_updated_at >= documents.source_updated_at
       returning id::text as id, (xmax = 0) as inserted`,
      [
        args.title,
        args.source,
        args.content,
        createdBy,
        sourceApp,
        args.key,
        args.path,
        args.updatedAt,
      ],
    );
    const row = rows[0];
    if (row === undefined) {
      // Der gespeicherte Stand ist neuer. Nichts ersetzt, nichts verloren.
      const existing = await tx<{ id: string; chunk_count: number }>(
        `select d.id::text as id,
                (select count(*)::int from chunks c where c.document_id = d.id) as chunk_count
           from documents d
          where d.source_app = $1 and d.source_key = $2`,
        [sourceApp, args.key],
      );
      const current = existing[0];
      if (current === undefined) throw new Error('upsert returned no row and no document exists');
      return {
        id: current.id,
        key: args.key,
        status: 'stale' as const,
        chunkCount: Number(current.chunk_count),
      };
    }
    await replaceChunks(tx, row.id, chunks);
    return {
      id: row.id,
      key: args.key,
      status: row.inserted ? ('created' as const) : ('updated' as const),
      chunkCount: chunks.length,
    };
  });
  if (result.status !== 'stale') kickEmbeddings();
  return result;
}

/**
 * `documents.remove`: entfernt das Dokument der Quell-App mit diesem
 * Schluessel, samt Abschnitten, endgueltig. Idempotent: Gibt es keines, ist
 * `removed` false und kein Fehler — eine wiederholte Lieferung soll nicht
 * scheitern. Wie bei `upsert` kommt `sourceApp` nur aus der Identitaet.
 */
export async function removeSourceDocument(
  args: RemoveArgs,
  sourceApp: string,
): Promise<{ key: string; removed: boolean }> {
  const rows = await query<{ id: string }>(
    `delete from documents where source_app = $1 and source_key = $2 returning id::text as id`,
    [sourceApp, args.key],
  );
  return { key: args.key, removed: rows.length > 0 };
}

/**
 * Zerlegt Dokumente, die noch keine Abschnitte haben — heute nur die
 * Beispieldokumente aus `seeds/0001_sample_documents.sql`. Je Dokument eine
 * Transaktion; `for update skip locked` laesst zwei gleichzeitig startende
 * Instanzen nie dasselbe Dokument zerlegen. Gibt die Zahl der zerlegten
 * Dokumente zurueck.
 */
export async function chunkPendingDocuments(maxDocuments = 1000): Promise<number> {
  let done = 0;
  while (done < maxDocuments) {
    const handled = await withTransaction(async (tx) => {
      const rows = await tx<{ id: string; content: string }>(
        `select d.id::text as id, d.content from documents d
          where d.deleted_at is null
            and not exists (select 1 from chunks c where c.document_id = d.id)
          order by d.created_at, d.id
          limit 1
          for update skip locked`,
      );
      const row = rows[0];
      if (row === undefined) return false;
      const chunks = chunkText(row.content);
      // Die Tabelle verlangt Text; ein Dokument ohne Abschnitte bleibt sonst
      // fuer immer "noch nicht zerlegt". Das kann nur ein Dokument sein, das
      // an `documents.add` vorbei angelegt wurde.
      if (chunks.length === 0) throw new Error(`Document ${row.id} contains no text`);
      await insertChunks(tx, row.id, chunks);
      return true;
    });
    if (!handled) break;
    done += 1;
  }
  return done;
}
