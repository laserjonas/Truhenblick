import { describe, expect, it } from 'vitest';
import type { Artikel, Bereich } from './types.ts';
import { bereinigeArtikel, istArtikel, istBereich } from './validierung.ts';

const T = '2026-10-09T08:00:00.000Z';

const BEREICH: Bereich = {
  id: 'b1',
  name: 'Korb links',
  typ: 'korb',
  reihenfolge: 0,
  parentId: null,
  geaendertAm: T,
  geloeschtAm: null,
};

const ARTIKEL: Artikel = {
  id: 'a1',
  name: 'Hackfleisch',
  kategorie: 'fleisch',
  emoji: '🥩',
  menge: 2,
  einheit: 'packung',
  eingefrorenAm: '2026-10-09',
  haltbarBis: '2027-01-09',
  bereichId: 'b1',
  notiz: '',
  erstelltAm: T,
  geaendertAm: T,
  geloeschtAm: null,
};

describe('istBereich', () => {
  it('akzeptiert gültige Bereiche', () => {
    expect(istBereich(BEREICH)).toBe(true);
    expect(istBereich({ ...BEREICH, typ: 'fach', parentId: 'e1', geloeschtAm: T })).toBe(true);
  });

  it('lehnt Unvollständiges und Falsches ab', () => {
    expect(istBereich(null)).toBe(false);
    expect(istBereich([])).toBe(false);
    expect(istBereich({ ...BEREICH, typ: 'schublade' })).toBe(false);
    expect(istBereich({ ...BEREICH, name: '' })).toBe(false);
    expect(istBereich({ ...BEREICH, reihenfolge: '1' })).toBe(false);
    expect(istBereich({ ...BEREICH, geaendertAm: 'gestern' })).toBe(false);
  });
});

describe('istArtikel', () => {
  it('akzeptiert gültige Artikel', () => {
    expect(istArtikel(ARTIKEL)).toBe(true);
    expect(istArtikel({ ...ARTIKEL, haltbarBis: null, menge: 0.5 })).toBe(true);
  });

  it('lehnt Unvollständiges und Falsches ab', () => {
    expect(istArtikel({ ...ARTIKEL, menge: -1 })).toBe(false);
    expect(istArtikel({ ...ARTIKEL, menge: Number.NaN })).toBe(false);
    expect(istArtikel({ ...ARTIKEL, eingefrorenAm: '09.10.2026' })).toBe(false);
    expect(istArtikel({ ...ARTIKEL, name: 'x'.repeat(500) })).toBe(false);
    const { bereichId: _, ...ohneBereich } = ARTIKEL;
    expect(istArtikel(ohneBereich)).toBe(false);
  });

  it('entfernt beim Bereinigen fremde Felder', () => {
    const mitZusatz = { ...ARTIKEL, dirty: 1, boese: '<script>' } as Artikel;
    expect(bereinigeArtikel(mitZusatz)).toEqual(ARTIKEL);
  });
});
