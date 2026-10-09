import { describe, expect, it } from 'vitest';
import type { Artikel } from '../../shared/types.ts';
import { sortiereArtikel, sucheArtikel } from './suche.ts';

const T = '2026-10-09T08:00:00.000Z';

function artikel(teil: Partial<Artikel> & Pick<Artikel, 'name'>): Artikel {
  return {
    id: teil.name,
    kategorie: 'sonstiges',
    emoji: '📦',
    menge: 1,
    einheit: 'stueck',
    eingefrorenAm: '2026-10-01',
    haltbarBis: null,
    bereichId: 'b',
    notiz: '',
    erstelltAm: T,
    geaendertAm: T,
    geloeschtAm: null,
    ...teil,
  };
}

const LISTE = [
  artikel({ name: 'Hackfleisch', kategorie: 'fleisch', haltbarBis: '2026-12-01' }),
  artikel({ name: 'Rinderhack', kategorie: 'fleisch', haltbarBis: '2026-11-01', eingefrorenAm: '2026-08-01' }),
  artikel({ name: 'Brötchen', kategorie: 'brot', notiz: 'vom Bäcker Hackmann', haltbarBis: '2027-01-01' }),
  artikel({ name: 'Erbsen', kategorie: 'gemuese', haltbarBis: '2027-08-01' }),
];

describe('sucheArtikel', () => {
  it('liefert bei leerer Anfrage nichts', () => {
    expect(sucheArtikel(LISTE, '  ')).toEqual([]);
  });

  it('findet Teilwörter und stellt Namensanfänge nach vorne', () => {
    expect(sucheArtikel(LISTE, 'hack').map((a) => a.name)).toEqual(['Hackfleisch', 'Rinderhack', 'Brötchen']);
  });

  it('ignoriert Umlaute und Großschreibung', () => {
    expect(sucheArtikel(LISTE, 'BROT').map((a) => a.name)).toEqual(['Brötchen']);
  });

  it('findet über die Kategorie', () => {
    expect(sucheArtikel(LISTE, 'gemüse').map((a) => a.name)).toEqual(['Erbsen']);
  });

  it('verlangt alle Suchwörter', () => {
    expect(sucheArtikel(LISTE, 'hack fleisch').map((a) => a.name)).toEqual(['Hackfleisch', 'Rinderhack']);
    expect(sucheArtikel(LISTE, 'hack erbsen')).toEqual([]);
  });
});

describe('sortiereArtikel', () => {
  it('sortiert nach Ablauf', () => {
    expect(sortiereArtikel(LISTE, 'ablauf').map((a) => a.name)).toEqual([
      'Rinderhack',
      'Hackfleisch',
      'Brötchen',
      'Erbsen',
    ]);
  });

  it('sortiert nach Name und Einfrierdatum', () => {
    expect(sortiereArtikel(LISTE, 'name').map((a) => a.name)).toEqual(['Brötchen', 'Erbsen', 'Hackfleisch', 'Rinderhack']);
    expect(sortiereArtikel(LISTE, 'eingefroren')[0]?.name).toBe('Rinderhack');
  });

  it('lässt die Ausgangsliste unverändert', () => {
    const kopie = [...LISTE];
    sortiereArtikel(LISTE, 'name');
    expect(LISTE).toEqual(kopie);
  });
});
