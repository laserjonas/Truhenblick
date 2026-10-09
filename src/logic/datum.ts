/** Rechnen mit Kalendertagen im Format JJJJ-MM-TT, unabhängig von Zeitzonen. */

function zerlege(iso: string): [number, number, number] {
  const [j, m, t] = iso.split('-').map(Number);
  return [j ?? 1970, m ?? 1, t ?? 1];
}

function zweistellig(n: number): string {
  return String(n).padStart(2, '0');
}

function baue(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${zweistellig(monat)}-${zweistellig(tag)}`;
}

/** Heutiges Datum in der Zeitzone des Geräts. */
export function heuteIso(jetzt: Date = new Date()): string {
  return baue(jetzt.getFullYear(), jetzt.getMonth() + 1, jetzt.getDate());
}

function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/** Addiert Monate; gibt es den Tag im Zielmonat nicht (31.01. + 1), wird der Monatsletzte genommen. */
export function addMonate(iso: string, monate: number): string {
  const [j, m, t] = zerlege(iso);
  const gesamt = j * 12 + (m - 1) + monate;
  const jahr = Math.floor(gesamt / 12);
  const monat = (gesamt % 12) + 1;
  return baue(jahr, monat, Math.min(t, tageImMonat(jahr, monat)));
}

/** Ganze Tage von `von` bis `bis` (negativ, wenn `bis` davor liegt). */
export function tageZwischen(von: string, bis: string): number {
  const [j1, m1, t1] = zerlege(von);
  const [j2, m2, t2] = zerlege(bis);
  return Math.round((Date.UTC(j2, m2 - 1, t2) - Date.UTC(j1, m1 - 1, t1)) / 86_400_000);
}

/** 09.10.2026 */
export function datumAnzeige(iso: string): string {
  const [j, m, t] = zerlege(iso);
  return `${zweistellig(t)}.${zweistellig(m)}.${j}`;
}
