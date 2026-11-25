import { ToolInputError, ToolNotFoundError } from '@openapps/sdk';
import { chunkText } from './chunk';
import { query, withTransaction, type QueryFn } from './db';
import type { DocumentInput, GetArgs, ListArgs } from './schemas';

/**
 * Die Fachlogik hinter den Tools `documents.*`. Kein Auth- und kein
 * Rechte-Code: Wer hier ankommt, hat das Gateway oder den Plattform-MCP
 * passiert. `createdBy` ist nur die Identitaet fuer die Spalte, keine Pruefung.
 */

export interface DocumentSummary {
  id: string;
  title: string;
  source: string | null;
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
  char_count: number;
  chunk_count: number;
  created_by: string;
  created_at: Date;
}

const toSummary = (row: DocumentRow): DocumentSummary => ({
  id: row.id,
  title: row.title,
  source: row.source,
  charCount: Number(row.char_count),
  chunkCount: Number(row.chunk_count),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const SUMMARY_COLUMNS = `
  d.id::text as id, d.title, d.source, d.char_count, d.created_by, d.created_at,
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
  return withTransaction(async (tx) => {
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
}

/** `%` und `_` sind in `ilike` Platzhalter; aus der Eingabe gelten sie woertlich. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `documents.list`: neueste zuerst, hoechstens 200, ohne Volltext. */
export async function listDocuments(args: ListArgs = {}): Promise<DocumentSummary[]> {
  const q = args.q?.trim() ?? '';
  const rows =
    q === ''
      ? await query<DocumentRow>(
          `select ${SUMMARY_COLUMNS} from documents d
            where d.deleted_at is null
            order by d.created_at desc, d.title
            limit 200`,
        )
      : await query<DocumentRow>(
          `select ${SUMMARY_COLUMNS} from documents d
            where d.deleted_at is null
              and (d.title ilike $1 escape '\\' or d.source ilike $1 escape '\\')
            order by d.created_at desc, d.title
            limit 200`,
          [`%${escapeLike(q)}%`],
        );
  return rows.map(toSummary);
}

/** `documents.get`: wirft `ToolNotFoundError` fuer unbekannte und geloeschte Dokumente. */
export async function getDocument(
  args: GetArgs,
): Promise<{ document: DocumentDetail; chunks?: Chunk[] }> {
  const rows = await query<DocumentRow & { content: string }>(
    `select ${SUMMARY_COLUMNS}, d.content from documents d
      where d.id = $1::uuid and d.deleted_at is null`,
    [args.id],
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

/** `documents.delete`: weich. Ein zweites Loeschen ergibt 404, nicht still Erfolg. */
export async function deleteDocument(id: string): Promise<{ id: string; deleted: true }> {
  const rows = await query<{ id: string }>(
    `update documents set deleted_at = now()
      where id = $1::uuid and deleted_at is null
      returning id::text as id`,
    [id],
  );
  if (rows[0] === undefined) {
    throw new ToolNotFoundError(`Document ${id} does not exist or has already been deleted`);
  }
  return { id, deleted: true };
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
