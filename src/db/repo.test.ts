import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { baueStruktur } from '../logic/truhe.ts';
import { db } from './db.ts';
import {
  artikelAendern,
  artikelAnlegen,
  artikelEntnehmen,
  artikelWiederherstellen,
  bereichAnlegen,
  bereichLoeschen,
  bereichVerschieben,
  mengeAendern,
  truheEinrichten,
  type ArtikelEingabe,
} from './repo.ts';

function eingabe(bereichId: string, teil: Partial<ArtikelEingabe> = {}): ArtikelEingabe {
  return {
    name: 'Hackfleisch',
    kategorie: 'fleisch',
    emoji: '🥩',
    menge: 2,
    einheit: 'packung',
    eingefrorenAm: '2026-10-09',
    haltbarBis: '2027-01-09',
    bereichId,
    notiz: '',
    ...teil,
  };
}

beforeEach(async () => {
  await Promise.all([db.bereiche.clear(), db.artikel.clear(), db.meta.clear()]);
});

describe('truheEinrichten', () => {
  it('legt Körbe, Ebenen und Fächer mit Zuordnung an', async () => {
    await truheEinrichten({ koerbe: 2, ebenen: 2, faecherJeEbene: 2 });
    const struktur = baueStruktur(await db.bereiche.toArray());
    expect(struktur.koerbe.map((b) => b.name)).toEqual(['Korb links', 'Korb rechts']);
    expect(struktur.ebenen.map((e) => e.ebene.name)).toEqual(['Oben', 'Boden']);
    expect(struktur.ebenen.map((e) => e.faecher.map((f) => f.name))).toEqual([
      ['Links', 'Rechts'],
      ['Links', 'Rechts'],
    ]);
    expect((await db.bereiche.toArray()).every((b) => b.dirty === 1)).toBe(true);
  });
});

describe('Artikel', () => {
  it('ändert die Menge schrittweise und entnimmt bei 0', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await artikelAnlegen(eingabe(korb.id, { menge: 2 }));

    await mengeAendern(a.id, 1);
    expect((await db.artikel.get(a.id))?.menge).toBe(3);

    await mengeAendern(a.id, -1);
    await mengeAendern(a.id, -1);
    const letzter = await mengeAendern(a.id, -1);
    expect(letzter?.entnommen).toBe(true);
    expect(letzter?.vorher.menge).toBe(1);
    expect((await db.artikel.get(a.id))?.geloeschtAm).not.toBeNull();
  });

  it('rechnet bei Gewichten mit dem Schritt der Einheit', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const g = await artikelAnlegen(eingabe(korb.id, { menge: 250, einheit: 'g' }));
    await mengeAendern(g.id, -1);
    expect((await db.artikel.get(g.id))?.menge).toBe(150);
    const kg = await artikelAnlegen(eingabe(korb.id, { menge: 0.5, einheit: 'kg' }));
    expect((await mengeAendern(kg.id, -1))?.entnommen).toBe(true);
  });

  it('macht Entnehmen und Ändern rückgängig', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const fach = await bereichAnlegen('Boden', 'ebene');
    const a = await artikelAnlegen(eingabe(korb.id));

    const vorEntnahme = await artikelEntnehmen(a.id);
    expect((await db.artikel.get(a.id))?.geloeschtAm).not.toBeNull();
    await artikelWiederherstellen(vorEntnahme!);
    expect((await db.artikel.get(a.id))?.geloeschtAm).toBeNull();

    const vorher = (await db.artikel.get(a.id))!;
    await artikelAendern(a.id, { bereichId: fach.id, menge: 5 });
    await artikelWiederherstellen(vorher);
    const danach = (await db.artikel.get(a.id))!;
    expect(danach.bereichId).toBe(korb.id);
    expect(danach.menge).toBe(2);
  });

  it('stempelt jede Änderung später als die vorige und merkt sie für den Abgleich vor', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await artikelAnlegen(eingabe(korb.id));
    await db.artikel.update(a.id, { dirty: 0 });
    await mengeAendern(a.id, 1);
    const b = (await db.artikel.get(a.id))!;
    expect(b.dirty).toBe(1);
    expect(Date.parse(b.geaendertAm)).toBeGreaterThan(Date.parse(a.geaendertAm));
    expect(b.erstelltAm).toBe(a.erstelltAm);
  });
});

describe('Bereiche', () => {
  it('löscht nur leere Bereiche – dann samt Fächern', async () => {
    const ebene = await bereichAnlegen('Oben', 'ebene');
    const fach = await bereichAnlegen('Links', 'fach', ebene.id);
    const a = await artikelAnlegen(eingabe(fach.id));

    expect(await bereichLoeschen(ebene.id)).toBe(false);
    expect((await db.bereiche.get(ebene.id))?.geloeschtAm).toBeNull();

    await artikelEntnehmen(a.id);
    expect(await bereichLoeschen(ebene.id)).toBe(true);
    expect((await db.bereiche.get(ebene.id))?.geloeschtAm).not.toBeNull();
    expect((await db.bereiche.get(fach.id))?.geloeschtAm).not.toBeNull();
  });

  it('hängt neue Bereiche hinten an und tauscht Nachbarn', async () => {
    const a = await bereichAnlegen('A', 'korb');
    const b = await bereichAnlegen('B', 'korb');
    const c = await bereichAnlegen('C', 'korb');
    const namen = async () => baueStruktur(await db.bereiche.toArray()).koerbe.map((k) => k.name);
    expect(await namen()).toEqual(['A', 'B', 'C']);

    await bereichVerschieben(c.id, -1);
    expect(await namen()).toEqual(['A', 'C', 'B']);
    await bereichVerschieben(a.id, 1);
    expect(await namen()).toEqual(['C', 'A', 'B']);
    await bereichVerschieben(c.id, -1);
    expect(await namen()).toEqual(['C', 'A', 'B']);
    expect(b.reihenfolge).toBe(1);
  });
});
