import { describe, expect, it } from 'vitest';
import { eingehendeGewinnt, vergleicheFassungen, zeitstempelNach, zusammenfuehren } from './sync.ts';
import type { SyncDoc } from './types.ts';

interface Doc extends SyncDoc {
  wert: string;
}

function doc(wert: string, geaendertAm: string, geloescht = false): Doc {
  return { id: 'x', wert, geaendertAm, geloeschtAm: geloescht ? geaendertAm : null };
}

const FRUEH = '2026-10-09T08:00:00.000Z';
const SPAET = '2026-10-09T08:00:01.000Z';

describe('letzte Änderung gewinnt', () => {
  it('übernimmt Unbekanntes', () => {
    expect(eingehendeGewinnt(undefined, doc('neu', FRUEH))).toBe(true);
  });

  it('nimmt die spätere Änderung, egal von welcher Seite', () => {
    expect(zusammenfuehren(doc('alt', FRUEH), doc('neu', SPAET)).wert).toBe('neu');
    expect(zusammenfuehren(doc('neu', SPAET), doc('alt', FRUEH)).wert).toBe('neu');
  });

  it('lässt eine spätere Bearbeitung eine frühere Löschung aufheben und umgekehrt', () => {
    expect(zusammenfuehren(doc('weg', FRUEH, true), doc('wieder da', SPAET)).geloeschtAm).toBeNull();
    expect(zusammenfuehren(doc('da', FRUEH), doc('weg', SPAET, true)).geloeschtAm).toBe(SPAET);
  });

  it('ändert nichts bei identischer Fassung', () => {
    expect(eingehendeGewinnt(doc('gleich', FRUEH), doc('gleich', FRUEH))).toBe(false);
  });

  it('vergleicht Zeitpunkte, nicht Zeichenketten', () => {
    const mitOffset = doc('offset', '2026-10-09T10:00:00.500+02:00');
    expect(vergleicheFassungen(mitOffset, doc('utc', FRUEH))).toBeGreaterThan(0);
  });
});

describe('gleicher Zeitstempel', () => {
  it('bevorzugt die Löschung', () => {
    expect(zusammenfuehren(doc('da', FRUEH), doc('da', FRUEH, true)).geloeschtAm).toBe(FRUEH);
    expect(zusammenfuehren(doc('da', FRUEH, true), doc('da', FRUEH)).geloeschtAm).toBe(FRUEH);
  });

  it('führt unabhängig von der Reihenfolge zum selben Ergebnis', () => {
    const a = doc('a', FRUEH);
    const b = doc('b', FRUEH);
    expect(zusammenfuehren(a, b)).toEqual(zusammenfuehren(b, a));
  });

  it('hängt nicht von der Reihenfolge der Felder ab', () => {
    const a: Doc = { id: 'x', wert: 'a', geaendertAm: FRUEH, geloeschtAm: null };
    const b: Doc = { geloeschtAm: null, geaendertAm: FRUEH, wert: 'a', id: 'x' };
    expect(vergleicheFassungen(a, b)).toBe(0);
  });
});

describe('Abgleich mehrerer Geräte', () => {
  it('endet überall gleich, egal in welcher Reihenfolge die Änderungen eintreffen', () => {
    const aenderungen = [doc('eins', FRUEH), doc('zwei', SPAET), doc('drei', '2026-10-09T08:00:00.500Z', true)];
    const reihenfolgen = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [1, 2, 0],
    ];
    const ergebnisse = reihenfolgen.map((r) =>
      r.reduce<Doc | undefined>((stand, i) => zusammenfuehren(stand, aenderungen[i] as Doc), undefined),
    );
    for (const e of ergebnisse) expect(e?.wert).toBe('zwei');
  });
});

describe('zeitstempelNach', () => {
  const jetzt = new Date('2026-10-09T08:00:00.000Z');

  it('nimmt die aktuelle Zeit', () => {
    expect(zeitstempelNach(undefined, jetzt)).toBe(FRUEH);
    expect(zeitstempelNach('2026-10-01T00:00:00.000Z', jetzt)).toBe(FRUEH);
  });

  it('stempelt nach der letzten Änderung, wenn die Geräteuhr nachgeht', () => {
    const zukunft = '2026-10-09T09:00:00.000Z';
    const neu = zeitstempelNach(zukunft, jetzt);
    expect(neu).toBe('2026-10-09T09:00:00.001Z');
    expect(eingehendeGewinnt(doc('fern', zukunft), doc('lokal', neu))).toBe(true);
  });
});
