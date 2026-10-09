import { describe, expect, it } from 'vitest';
import type { Artikel, Bereich } from '../../shared/types.ts';
import {
  artikelJeBereich,
  baueStruktur,
  bereichPfad,
  ebenenNamen,
  fachSpalten,
  korbNamen,
  OHNE_BEREICH,
  standardBereiche,
} from './truhe.ts';

const T = '2026-10-09T08:00:00.000Z';

function bereich(teil: Partial<Bereich> & Pick<Bereich, 'id' | 'typ'>): Bereich {
  return { name: teil.id, reihenfolge: 0, parentId: null, geaendertAm: T, geloeschtAm: null, ...teil };
}

function artikel(id: string, bereichId: string, geloescht = false): Artikel {
  return {
    id,
    name: id,
    kategorie: 'sonstiges',
    emoji: '📦',
    menge: 1,
    einheit: 'stueck',
    eingefrorenAm: '2026-10-01',
    haltbarBis: null,
    bereichId,
    notiz: '',
    erstelltAm: T,
    geaendertAm: T,
    geloeschtAm: geloescht ? T : null,
  };
}

describe('standardBereiche', () => {
  it('legt Körbe, Ebenen und Fächer an', () => {
    const entwurf = standardBereiche({ koerbe: 2, ebenen: 3, faecherJeEbene: 2 });
    expect(entwurf.filter((b) => b.typ === 'korb').map((b) => b.name)).toEqual(['Korb links', 'Korb rechts']);
    expect(entwurf.filter((b) => b.typ === 'ebene').map((b) => b.name)).toEqual(['Oben', 'Mitte', 'Boden']);
    const faecher = entwurf.filter((b) => b.typ === 'fach');
    expect(faecher).toHaveLength(6);
    expect(faecher.filter((f) => f.ebeneIndex === 1).map((f) => f.name)).toEqual(['Links', 'Rechts']);
  });

  it('kommt ohne Körbe und Fächer aus', () => {
    const entwurf = standardBereiche({ koerbe: 0, ebenen: 1, faecherJeEbene: 1 });
    expect(entwurf).toEqual([{ name: 'Boden', typ: 'ebene', reihenfolge: 0, ebeneIndex: null }]);
  });

  it('benennt sinnvoll', () => {
    expect(korbNamen(1)).toEqual(['Korb']);
    expect(korbNamen(4)).toEqual(['Korb 1', 'Korb 2', 'Korb 3', 'Korb 4']);
    expect(ebenenNamen(4)).toEqual(['Ebene 1', 'Ebene 2', 'Ebene 3', 'Boden']);
    expect(fachSpalten(4)).toBe(2);
    expect(fachSpalten(3)).toBe(3);
  });
});

describe('baueStruktur', () => {
  const bereiche = [
    bereich({ id: 'e2', typ: 'ebene', reihenfolge: 1 }),
    bereich({ id: 'e1', typ: 'ebene', reihenfolge: 0 }),
    bereich({ id: 'k2', typ: 'korb', reihenfolge: 1 }),
    bereich({ id: 'k1', typ: 'korb', reihenfolge: 0 }),
    bereich({ id: 'f2', typ: 'fach', parentId: 'e1', reihenfolge: 1 }),
    bereich({ id: 'f1', typ: 'fach', parentId: 'e1', reihenfolge: 0 }),
    bereich({ id: 'weg', typ: 'korb', geloeschtAm: T }),
    bereich({ id: 'waise', typ: 'fach', parentId: 'gibt-es-nicht' }),
  ];

  it('sortiert und verschachtelt', () => {
    const s = baueStruktur(bereiche);
    expect(s.koerbe.map((b) => b.id)).toEqual(['k1', 'k2']);
    expect(s.ebenen.map((e) => e.ebene.id)).toEqual(['e1', 'e2', 'waise']);
    expect(s.ebenen[0]?.faecher.map((b) => b.id)).toEqual(['f1', 'f2']);
  });

  it('bildet den Pfad eines Fachs', () => {
    const fach = bereiche.find((b) => b.id === 'f1') as Bereich;
    expect(bereichPfad(fach, bereiche)).toBe('e1 › f1');
    expect(bereichPfad(bereiche[0] as Bereich, bereiche)).toBe('e2');
  });
});

describe('artikelJeBereich', () => {
  it('gruppiert und fängt heimatlose Artikel auf', () => {
    const bereiche = [bereich({ id: 'k1', typ: 'korb' }), bereich({ id: 'alt', typ: 'korb', geloeschtAm: T })];
    const map = artikelJeBereich(
      [artikel('a', 'k1'), artikel('b', 'k1'), artikel('c', 'alt'), artikel('d', 'k1', true)],
      bereiche,
    );
    expect(map.get('k1')?.map((a) => a.id)).toEqual(['a', 'b']);
    expect(map.get(OHNE_BEREICH)?.map((a) => a.id)).toEqual(['c']);
  });
});
