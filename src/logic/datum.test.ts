import { describe, expect, it } from 'vitest';
import { addMonate, datumAnzeige, heuteIso, tageZwischen } from './datum.ts';

describe('addMonate', () => {
  it('addiert Monate über den Jahreswechsel', () => {
    expect(addMonate('2026-10-09', 3)).toBe('2027-01-09');
    expect(addMonate('2026-10-09', 12)).toBe('2027-10-09');
    expect(addMonate('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('nimmt den Monatsletzten, wenn es den Tag nicht gibt', () => {
    expect(addMonate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonate('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonate('2026-08-31', 3)).toBe('2026-11-30');
  });

  it('kann auch zurückrechnen', () => {
    expect(addMonate('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonate('2026-03-31', -1)).toBe('2026-02-28');
  });
});

describe('tageZwischen', () => {
  it('zählt Kalendertage', () => {
    expect(tageZwischen('2026-10-09', '2026-10-09')).toBe(0);
    expect(tageZwischen('2026-10-09', '2026-10-10')).toBe(1);
    expect(tageZwischen('2026-10-09', '2026-11-08')).toBe(30);
    expect(tageZwischen('2026-10-09', '2026-10-01')).toBe(-8);
  });

  it('bleibt über die Zeitumstellung hinweg ganzzahlig', () => {
    expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2);
    expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('heuteIso / datumAnzeige', () => {
  it('nutzt das lokale Datum', () => {
    expect(heuteIso(new Date(2026, 9, 9, 23, 59))).toBe('2026-10-09');
    expect(heuteIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('zeigt Daten deutsch an', () => {
    expect(datumAnzeige('2026-10-09')).toBe('09.10.2026');
  });
});
