import { describe, expect, it } from 'vitest';
import type { Artikel, Bereich } from './types.ts';
import { berechneUebersicht, heuteIn } from './uebersicht.ts';

const T = '2026-10-09T08:00:00.000Z';
const HEUTE = '2026-10-10';
const JETZT = new Date('2026-10-10T12:00:00.000Z');

function bereich(id: string, name: string, typ: Bereich['typ'], parentId: string | null = null, geloescht = false): Bereich {
  return { id, name, typ, reihenfolge: 0, parentId, geaendertAm: T, geloeschtAm: geloescht ? T : null };
}

function artikel(name: string, haltbarBis: string | null, teil: Partial<Artikel> = {}): Artikel {
  return {
    id: name,
    name,
    kategorie: 'fleisch',
    emoji: '🥩',
    menge: 2,
    einheit: 'packung',
    eingefrorenAm: '2026-07-01',
    haltbarBis,
    bereichId: 'korb',
    notiz: '',
    erstelltAm: T,
    geaendertAm: T,
    geloeschtAm: null,
    ...teil,
  };
}

const BEREICHE = [bereich('korb', 'Korb links', 'korb'), bereich('oben', 'Oben', 'ebene'), bereich('links', 'Links', 'fach', 'oben')];

describe('berechneUebersicht', () => {
  const bestand = [
    artikel('Erbsen', '2027-08-01', { kategorie: 'gemuese', emoji: '🫛', einheit: 'beutel' }),
    artikel('Bratwürste', '2026-10-16', { emoji: '🌭', menge: 8, einheit: 'stueck' }),
    artikel('Brötchen', '2026-09-01', { kategorie: 'brot', emoji: '🥖', menge: 6, einheit: 'stueck' }),
    artikel('Lachs', '2026-10-25', { kategorie: 'fisch', emoji: '🐟', menge: 400, einheit: 'g', bereichId: 'links' }),
    artikel('Entnommen', '2026-01-01', { geloeschtAm: T }),
  ];
  const u = berechneUebersicht(BEREICHE, bestand, HEUTE, { jetzt: JETZT });

  it('zählt nach Ampel – ohne Entnommenes', () => {
    expect({ artikel: u.artikel, frisch: u.frisch, bald: u.bald, ueberfaellig: u.ueberfaellig, faellig: u.faellig }).toEqual({
      artikel: 4,
      frisch: 1,
      bald: 2,
      ueberfaellig: 1,
      faellig: 3,
    });
    expect(u.text).toBe('2 bald fällig, 1 überfällig');
    expect(u.schwelle_tage).toBe(30);
    expect(u.heute).toBe(HEUTE);
    expect(u.stand).toBe('2026-10-10T12:00:00.000Z');
  });

  it('listet das Fällige, Dringendes zuerst, mit Menge, Ort und Resttagen', () => {
    expect(u.liste.map((a) => a.name)).toEqual(['Brötchen', 'Bratwürste', 'Lachs']);
    expect(u.liste[0]).toEqual({
      name: 'Brötchen',
      emoji: '🥖',
      kategorie: 'brot',
      menge: '6 Stück',
      ort: 'Korb links',
      haltbar_bis: '2026-09-01',
      tage: -39,
      status: 'ueberfaellig',
      text: '39 Tage überfällig',
    });
    expect(u.liste[2]).toMatchObject({ menge: '400 g', ort: 'Oben › Links', tage: 15, status: 'bald', text: 'noch 15 Tage' });
    expect(u.naechster?.name).toBe('Brötchen');
    expect(u.gekuerzt).toBe(false);
  });

  it('kürzt lange Listen und sagt das', () => {
    const kurz = berechneUebersicht(BEREICHE, bestand, HEUTE, { limit: 2 });
    expect(kurz.liste.map((a) => a.name)).toEqual(['Brötchen', 'Bratwürste']);
    expect(kurz.gekuerzt).toBe(true);
    expect(kurz.faellig).toBe(3);
  });

  it('rechnet mit einer anderen Schwelle', () => {
    const eng = berechneUebersicht(BEREICHE, bestand, HEUTE, { tage: 7 });
    expect(eng.liste.map((a) => a.name)).toEqual(['Brötchen', 'Bratwürste']);
    expect({ bald: eng.bald, frisch: eng.frisch, schwelle: eng.schwelle_tage }).toEqual({ bald: 1, frisch: 2, schwelle: 7 });
  });

  it('nimmt ohne eingetragenes Datum die Standardhaltbarkeit der Kategorie', () => {
    // Fleisch: 9 Monate ab 01.02.2026 → 01.11.2026
    const ohne = berechneUebersicht(BEREICHE, [artikel('Braten', null, { eingefrorenAm: '2026-02-01' })], HEUTE);
    expect(ohne.liste[0]).toMatchObject({ haltbar_bis: '2026-11-01', tage: 22, status: 'bald' });
  });

  it('nennt Artikel ohne gültigen Bereich „Nicht zugeordnet“', () => {
    const bereiche = [...BEREICHE, bereich('alt', 'Alter Korb', 'korb', null, true)];
    const liste = berechneUebersicht(bereiche, [artikel('A', '2026-10-12', { bereichId: 'alt' }), artikel('B', '2026-10-12', { bereichId: 'weg' })], HEUTE).liste;
    expect(liste.map((a) => a.ort)).toEqual(['Nicht zugeordnet', 'Nicht zugeordnet']);
  });

  it('fasst ruhige Zustände verständlich zusammen', () => {
    expect(berechneUebersicht(BEREICHE, [], HEUTE)).toMatchObject({ artikel: 0, faellig: 0, text: 'Die Truhe ist leer', naechster: null, liste: [] });
    const frisch = berechneUebersicht(BEREICHE, [artikel('Erbsen', '2027-08-01')], HEUTE);
    expect(frisch.text).toBe('Alles frisch (1 Artikel)');
    expect(frisch.naechster?.name).toBe('Erbsen');
  });
});

describe('heuteIn', () => {
  it('liefert das Datum der Zeitzone', () => {
    const kurzVorMitternachtUtc = new Date('2026-10-10T22:30:00.000Z');
    expect(heuteIn('UTC', kurzVorMitternachtUtc)).toBe('2026-10-10');
    expect(heuteIn('Europe/Berlin', kurzVorMitternachtUtc)).toBe('2026-10-11');
    expect(heuteIn('America/New_York', kurzVorMitternachtUtc)).toBe('2026-10-10');
  });

  it('lehnt unbekannte Zeitzonen ab', () => {
    expect(() => heuteIn('Mond/Krater')).toThrow();
  });
});
