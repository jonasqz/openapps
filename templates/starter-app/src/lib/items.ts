import { z } from 'zod';
import { query } from './db.js';

export const ItemInput = z.object({
  title: z.string().trim().min(1).max(200),
});
export type ItemInput = z.infer<typeof ItemInput>;

export interface Item {
  id: string;
  title: string;
  createdAt: string;
}

interface ItemRow extends Record<string, unknown> {
  id: string;
  title: string;
  created_at: Date;
}

const toItem = (row: ItemRow): Item => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at.toISOString(),
});

/** Liest Einträge aus dem eigenen Schema. `q` filtert als Freitext. */
export async function listItems(q?: string): Promise<Item[]> {
  const rows =
    q === undefined || q === ''
      ? await query<ItemRow>(
          'select id, title, created_at from items order by created_at desc limit 200',
        )
      : await query<ItemRow>(
          'select id, title, created_at from items where title ilike $1 order by created_at desc limit 200',
          [`%${q}%`],
        );
  return rows.map(toItem);
}

export async function createItem(input: ItemInput): Promise<Item> {
  const rows = await query<ItemRow>(
    'insert into items (title) values ($1) returning id, title, created_at',
    [input.title],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert returned no row');
  return toItem(row);
}
