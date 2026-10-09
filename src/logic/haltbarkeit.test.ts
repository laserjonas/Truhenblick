import { describe, expect, it } from 'vitest';
import { BALD_VERBRAUCHEN_TAGE } from '../config/ampel.ts';
import { kategorieInfo } from '../config/kategorien.ts';
import { addMonate } from './datum.ts';
import { haltbarBisEffektiv, restText, resttage, statusAusResttagen, statusVon } from './haltbarkeit.ts';

const HEUTE = '2026-10-09';

describe('haltbarBisEffektiv', () => {
  it('nimmt das eingetragene Datum', () => {
    expect(haltbarBisEffektiv({ haltbarBis: '2027-02-01', eingefrorenAm: '2026-10-01', kategorie: 'fleisch' })).toBe(
      '2027-02-01',
    );
  });

  it('rechnet sonst mit der Standardhaltbarkeit der Kategorie', () => {
    const monate = kategorieInfo('gemuese').haltbarMonate;
    expect(haltbarBisEffektiv({ haltbarBis: null, eingefrorenAm: '2026-10-01', kategorie: 'gemuese' })).toBe(
      addMonate('2026-10-01', monate),
    );
  });

  it('fällt bei unbekannter Kategorie auf „Sonstiges“ zurück', () => {
    const monate = kategorieInfo('sonstiges').haltbarMonate;
    expect(haltbarBisEffektiv({ haltbarBis: null, eingefrorenAm: '2026-10-01', kategorie: 'gibt-es-nicht' })).toBe(
      addMonate('2026-10-01', monate),
    );
  });
});

describe('Ampel', () => {
  const artikel = (haltbarBis: string) => ({ haltbarBis, eingefrorenAm: '2026-01-01', kategorie: 'fleisch' });

  it('ist grün, solange mehr als die Schwelle bleibt', () => {
    expect(statusVon(artikel('2027-06-01'), HEUTE)).toBe('frisch');
    expect(statusAusResttagen(BALD_VERBRAUCHEN_TAGE + 1)).toBe('frisch');
  });

  it('ist gelb ab der Schwelle bis einschließlich Ablauftag', () => {
    expect(statusAusResttagen(BALD_VERBRAUCHEN_TAGE)).toBe('bald');
    expect(statusVon(artikel('2026-10-20'), HEUTE)).toBe('bald');
    expect(statusVon(artikel(HEUTE), HEUTE)).toBe('bald');
  });

  it('ist rot, sobald das Datum überschritten ist', () => {
    expect(statusVon(artikel('2026-10-08'), HEUTE)).toBe('ueberfaellig');
    expect(resttage(artikel('2026-10-08'), HEUTE)).toBe(-1);
  });

  it('erlaubt eine eigene Schwelle', () => {
    expect(statusAusResttagen(10, 7)).toBe('frisch');
    expect(statusAusResttagen(7, 7)).toBe('bald');
  });
});

describe('restText', () => {
  it('beschreibt die verbleibende Zeit', () => {
    expect(restText(0)).toBe('heute fällig');
    expect(restText(1)).toBe('noch 1 Tag');
    expect(restText(12)).toBe('noch 12 Tage');
    expect(restText(60)).toBe('noch 60 Tage');
    expect(restText(92)).toBe('noch 3 Monate');
    expect(restText(365)).toBe('noch 12 Monate');
  });

  it('beschreibt Überfälliges', () => {
    expect(restText(-1)).toBe('seit 1 Tag überfällig');
    expect(restText(-14)).toBe('seit 14 Tagen überfällig');
    expect(restText(-120)).toBe('seit 4 Monaten überfällig');
  });
});
