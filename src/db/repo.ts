import { zeitstempelNach } from '../../shared/sync.ts';
import type { Artikel, Bereich, BereichTyp } from '../../shared/types.ts';
import { einheitInfo } from '../config/einheiten.ts';
import { standardBereiche, type TruhenKonfig } from '../logic/truhe.ts';
import { db, neueId, type LokalerArtikel, type LokalerBereich } from './db.ts';

/** Wird nach jeder lokalen Änderung aufgerufen (z. B. um den Abgleich anzustoßen). */
const beobachter = new Set<() => void>();

export function beiAenderung(fn: () => void): () => void {
  beobachter.add(fn);
  return () => beobachter.delete(fn);
}

function melde(): void {
  for (const fn of beobachter) fn();
}

// ---------------------------------------------------------------- Artikel

export type ArtikelEingabe = Pick<
  Artikel,
  'name' | 'kategorie' | 'emoji' | 'menge' | 'einheit' | 'eingefrorenAm' | 'haltbarBis' | 'bereichId' | 'notiz'
>;

export async function artikelAnlegen(eingabe: ArtikelEingabe): Promise<Artikel> {
  const jetzt = zeitstempelNach(undefined);
  const artikel: LokalerArtikel = {
    ...eingabe,
    name: eingabe.name.trim(),
    id: neueId(),
    erstelltAm: jetzt,
    geaendertAm: jetzt,
    geloeschtAm: null,
    dirty: 1,
  };
  await db.artikel.add(artikel);
  melde();
  return artikel;
}

async function artikelSchreiben(id: string, aendere: (a: LokalerArtikel) => Partial<Artikel>): Promise<LokalerArtikel | null> {
  const ergebnis = await db.transaction('rw', db.artikel, async () => {
    const vorher = await db.artikel.get(id);
    if (!vorher) return null;
    const neu: LokalerArtikel = {
      ...vorher,
      ...aendere(vorher),
      id,
      geaendertAm: zeitstempelNach(vorher.geaendertAm),
      dirty: 1,
    };
    await db.artikel.put(neu);
    return vorher;
  });
  if (ergebnis) melde();
  return ergebnis;
}

export async function artikelAendern(id: string, aenderung: Partial<ArtikelEingabe>): Promise<void> {
  await artikelSchreiben(id, () => aenderung);
}

/** Entnimmt (löscht) einen Artikel und liefert den Stand davor – für „Rückgängig“. */
export async function artikelEntnehmen(id: string): Promise<Artikel | null> {
  return artikelSchreiben(id, () => ({ geloeschtAm: new Date().toISOString() }));
}

/** Stellt einen entnommenen oder geänderten Artikel im früheren Stand wieder her. */
export async function artikelWiederherstellen(vorher: Artikel): Promise<void> {
  await artikelSchreiben(vorher.id, () => ({ ...vorher, geloeschtAm: null }));
}

/** Rundet Rechenfehler bei Schritten wie 0,5 kg weg. */
function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Ändert die Menge um einen Schritt der Einheit (richtung −1 oder +1).
 * Fällt sie auf 0, wird der Artikel entnommen. Liefert den Stand davor.
 */
export async function mengeAendern(
  id: string,
  richtung: -1 | 1,
): Promise<{ vorher: Artikel; entnommen: boolean } | null> {
  let entnommen = false;
  const vorher = await artikelSchreiben(id, (a) => {
    const menge = runde(a.menge + richtung * einheitInfo(a.einheit).schritt);
    if (menge <= 0) {
      entnommen = true;
      return { geloeschtAm: new Date().toISOString() };
    }
    return { menge };
  });
  return vorher ? { vorher, entnommen } : null;
}

// ---------------------------------------------------------------- Bereiche

function neuerBereich(name: string, typ: BereichTyp, reihenfolge: number, parentId: string | null): LokalerBereich {
  return {
    id: neueId(),
    name,
    typ,
    reihenfolge,
    parentId,
    geaendertAm: zeitstempelNach(undefined),
    geloeschtAm: null,
    dirty: 1,
  };
}

/** Legt die Truhe laut Einrichtungsassistent an. */
export async function truheEinrichten(konfig: TruhenKonfig): Promise<void> {
  const entwurf = standardBereiche(konfig);
  const ebenenIds: string[] = [];
  const bereiche: LokalerBereich[] = [];
  for (const e of entwurf) {
    if (e.typ === 'fach') continue;
    const b = neuerBereich(e.name, e.typ, e.reihenfolge, null);
    if (e.typ === 'ebene') ebenenIds[e.reihenfolge] = b.id;
    bereiche.push(b);
  }
  for (const e of entwurf) {
    if (e.typ !== 'fach' || e.ebeneIndex === null) continue;
    bereiche.push(neuerBereich(e.name, 'fach', e.reihenfolge, ebenenIds[e.ebeneIndex] ?? null));
  }
  await db.bereiche.bulkAdd(bereiche);
  melde();
}

export async function bereichAnlegen(name: string, typ: BereichTyp, parentId: string | null = null): Promise<Bereich> {
  const bereich = await db.transaction('rw', db.bereiche, async () => {
    const geschwister = await db.bereiche
      .filter((b) => !b.geloeschtAm && b.typ === typ && b.parentId === parentId)
      .toArray();
    const reihenfolge = geschwister.reduce((max, b) => Math.max(max, b.reihenfolge + 1), 0);
    const b = neuerBereich(name.trim(), typ, reihenfolge, parentId);
    await db.bereiche.add(b);
    return b;
  });
  melde();
  return bereich;
}

async function bereichSchreiben(id: string, aenderung: Partial<Bereich>): Promise<void> {
  const vorher = await db.bereiche.get(id);
  if (!vorher) return;
  await db.bereiche.put({
    ...vorher,
    ...aenderung,
    id,
    geaendertAm: zeitstempelNach(vorher.geaendertAm),
    dirty: 1,
  });
}

export async function bereichUmbenennen(id: string, name: string): Promise<void> {
  const sauber = name.trim();
  if (!sauber) return;
  await bereichSchreiben(id, { name: sauber });
  melde();
}

/** Tauscht den Bereich mit seinem Nachbarn (richtung −1 = nach vorne/oben). */
export async function bereichVerschieben(id: string, richtung: -1 | 1): Promise<void> {
  await db.transaction('rw', db.bereiche, async () => {
    const bereich = await db.bereiche.get(id);
    if (!bereich) return;
    const geschwister = (
      await db.bereiche
        .filter((b) => !b.geloeschtAm && b.typ === bereich.typ && b.parentId === bereich.parentId)
        .toArray()
    ).sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de'));
    const von = geschwister.findIndex((b) => b.id === id);
    const nach = von + richtung;
    if (von < 0 || nach < 0 || nach >= geschwister.length) return;
    const [verschoben] = geschwister.splice(von, 1);
    geschwister.splice(nach, 0, verschoben as LokalerBereich);
    // Neu durchnummerieren, damit auch gleiche Nummern (z. B. nach einem Abgleich) eindeutig werden.
    for (const [i, b] of geschwister.entries()) {
      if (b.reihenfolge !== i) await bereichSchreiben(b.id, { reihenfolge: i });
    }
  });
  melde();
}

/** Anzahl der Artikel in diesem Bereich und seinen Fächern. */
export async function artikelImBereich(id: string): Promise<number> {
  const ids = new Set([id]);
  for (const f of await db.bereiche.where('parentId').equals(id).toArray()) {
    if (!f.geloeschtAm) ids.add(f.id);
  }
  return db.artikel.filter((a) => !a.geloeschtAm && ids.has(a.bereichId)).count();
}

/**
 * Löscht einen Bereich samt seiner Fächer. Enthält er noch Artikel, wird nichts
 * gelöscht und `false` geliefert – erst umräumen, dann löschen.
 */
export async function bereichLoeschen(id: string): Promise<boolean> {
  const geloescht = await db.transaction('rw', db.bereiche, db.artikel, async () => {
    if ((await artikelImBereich(id)) > 0) return false;
    const jetzt = new Date().toISOString();
    const faecher = await db.bereiche.where('parentId').equals(id).toArray();
    for (const b of [...faecher.filter((f) => !f.geloeschtAm), { id }]) {
      await bereichSchreiben(b.id, { geloeschtAm: jetzt });
    }
    return true;
  });
  if (geloescht) melde();
  return geloescht;
}
