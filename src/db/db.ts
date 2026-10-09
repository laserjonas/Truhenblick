import Dexie, { type EntityTable } from 'dexie';
import type { Artikel, Bereich } from '../../shared/types.ts';

/** Lokaler Zusatz: 1 = Änderung wurde noch nicht zum Sync-Server übertragen. */
export interface Lokal {
  dirty: 0 | 1;
}

export type LokalerBereich = Bereich & Lokal;
export type LokalerArtikel = Artikel & Lokal;

export interface MetaEintrag {
  key: string;
  value: unknown;
}

export type TruhenblickDb = Dexie & {
  bereiche: EntityTable<LokalerBereich, 'id'>;
  artikel: EntityTable<LokalerArtikel, 'id'>;
  meta: EntityTable<MetaEintrag, 'key'>;
};

export function oeffneDb(name = 'truhenblick'): TruhenblickDb {
  const db = new Dexie(name) as TruhenblickDb;
  db.version(1).stores({
    bereiche: 'id, parentId, dirty',
    artikel: 'id, bereichId, dirty',
    meta: 'key',
  });
  return db;
}

export const db = oeffneDb();

export async function metaLesen<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function metaSchreiben(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Entfernt die lokalen Zusatzfelder (für Backup und Sync). */
export function ohneLokal<T extends Lokal>(doc: T): Omit<T, 'dirty'> {
  const { dirty: _, ...rest } = doc;
  return rest;
}

/** UUID – funktioniert auch ohne HTTPS, wo crypto.randomUUID fehlt. */
export function neueId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
