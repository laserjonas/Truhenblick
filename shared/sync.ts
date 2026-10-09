import type { SyncDoc } from './types.ts';

function zeitwert(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Schlüssel in fester Reihenfolge, damit beide Seiten denselben Text vergleichen. */
function stabil(doc: object): string {
  const eintraege = Object.entries(doc).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(eintraege);
}

/**
 * Ordnet zwei Fassungen desselben Datensatzes: > 0 heißt, `a` ist die neuere.
 * Regel: letzte Änderung gewinnt (geaendertAm). Bei exakt gleichem Zeitstempel
 * gewinnt die Löschung, danach entscheidet der Inhalt – so kommen alle Geräte
 * unabhängig von der Reihenfolge zum selben Ergebnis.
 */
export function vergleicheFassungen<T extends SyncDoc>(a: T, b: T): number {
  const zeit = zeitwert(a.geaendertAm) - zeitwert(b.geaendertAm);
  if (zeit !== 0) return zeit;
  const geloescht = Number(a.geloeschtAm !== null) - Number(b.geloeschtAm !== null);
  if (geloescht !== 0) return geloescht;
  const sa = stabil(a);
  const sb = stabil(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Soll die eingehende Fassung die vorhandene ersetzen? */
export function eingehendeGewinnt<T extends SyncDoc>(vorhanden: T | undefined, eingehend: T): boolean {
  if (!vorhanden) return true;
  return vergleicheFassungen(eingehend, vorhanden) > 0;
}

/** Führt zwei Fassungen zusammen und liefert die gültige. */
export function zusammenfuehren<T extends SyncDoc>(vorhanden: T | undefined, eingehend: T): T {
  return eingehendeGewinnt(vorhanden, eingehend) ? eingehend : (vorhanden as T);
}

/**
 * Zeitstempel für eine neue Änderung. Liegt die Geräteuhr hinter der letzten
 * bekannten Änderung des Datensatzes, wird 1 ms nach dieser gestempelt –
 * sonst würde die neuere Bearbeitung beim Abgleich verlieren.
 */
export function zeitstempelNach(vorher: string | undefined, jetzt: Date = new Date()): string {
  const min = vorher ? zeitwert(vorher) + 1 : 0;
  return new Date(Math.max(jetzt.getTime(), min)).toISOString();
}
