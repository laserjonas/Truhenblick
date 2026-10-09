import { describe, expect, it } from 'vitest';
import { KATEGORIEN, STICHWOERTER } from '../config/kategorien.ts';
import { normalisiere, vorschlagFuer } from './vorschlag.ts';

describe('Konfiguration', () => {
  it('verweist nur auf vorhandene Kategorien', () => {
    const ids = new Set(KATEGORIEN.map((k) => k.id));
    for (const s of STICHWOERTER) expect(ids.has(s.kategorie), s.woerter.join(',')).toBe(true);
  });

  it('führt kein Stichwort doppelt', () => {
    const alle = STICHWOERTER.flatMap((s) => s.woerter.map(normalisiere));
    const doppelt = alle.filter((w, i) => alle.indexOf(w) !== i);
    expect(doppelt).toEqual([]);
  });
});

describe('vorschlagFuer', () => {
  it('erkennt Hackfleisch mit kurzer Haltbarkeit', () => {
    const v = vorschlagFuer('Hackfleisch');
    expect(v.kategorie).toBe('fleisch');
    expect(v.haltbarMonate).toBe(3);
    expect(v.quelle).toBe('stichwort');
  });

  it('erkennt zusammengesetzte Wörter am Wortende', () => {
    expect(vorschlagFuer('Rinderhackfleisch').haltbarMonate).toBe(3);
    expect(vorschlagFuer('Erbsensuppe').kategorie).toBe('fertig');
    expect(vorschlagFuer('Kürbiskernbrötchen').kategorie).toBe('brot');
    expect(vorschlagFuer('Erdbeereis').kategorie).toBe('eis');
    expect(vorschlagFuer('Kräuterbutter').emoji).toBe('🧈');
  });

  it('erkennt Wortanfänge, wenn das Ende nichts sagt', () => {
    expect(vorschlagFuer('Hähnchenbrust').kategorie).toBe('fleisch');
    expect(vorschlagFuer('Erdbeermarmelade').kategorie).toBe('obst');
  });

  it('ignoriert Mehrzahl, Groß-/Kleinschreibung und Umlaute', () => {
    expect(vorschlagFuer('ERBSEN').kategorie).toBe('gemuese');
    expect(vorschlagFuer('Möhren').emoji).toBe('🥕');
    expect(vorschlagFuer('brotchen').kategorie).toBe('brot');
    expect(vorschlagFuer('Steaks').kategorie).toBe('fleisch');
  });

  it('verwechselt Reis und Fleisch nicht mit Eis', () => {
    expect(vorschlagFuer('Reis').kategorie).toBe('fertig');
    expect(vorschlagFuer('Milchreis').kategorie).toBe('fertig');
    expect(vorschlagFuer('Fleisch').kategorie).not.toBe('eis');
    expect(vorschlagFuer('Vanilleeis').kategorie).toBe('eis');
  });

  it('nimmt Gemüse mit 12 Monaten', () => {
    const v = vorschlagFuer('Brokkoli');
    expect(v.kategorie).toBe('gemuese');
    expect(v.haltbarMonate).toBe(12);
  });

  it('fällt auf „Sonstiges“ zurück', () => {
    expect(vorschlagFuer('').quelle).toBe('standard');
    expect(vorschlagFuer('Xyz 123').kategorie).toBe('sonstiges');
  });

  it('übernimmt Angaben eines früher erfassten Artikels gleichen Namens', () => {
    const historie = [
      { name: 'Omas Spezial', kategorie: 'fertig', emoji: '🥘', einheit: 'portion', geaendertAm: '2026-01-01T10:00:00.000Z' },
      { name: 'omas spezial ', kategorie: 'fleisch', emoji: '🍖', einheit: 'beutel', geaendertAm: '2026-05-01T10:00:00.000Z' },
    ];
    const v = vorschlagFuer('Omas Spezial', historie);
    expect(v).toMatchObject({ kategorie: 'fleisch', emoji: '🍖', einheit: 'beutel', quelle: 'historie' });
  });

  it('behält die feinere Stichwort-Haltbarkeit, wenn die Kategorie zur Historie passt', () => {
    const historie = [
      { name: 'Hackfleisch', kategorie: 'fleisch', emoji: '🐄', einheit: 'packung', geaendertAm: '2026-01-01T10:00:00.000Z' },
    ];
    const v = vorschlagFuer('hackfleisch', historie);
    expect(v.emoji).toBe('🐄');
    expect(v.haltbarMonate).toBe(3);
  });
});
