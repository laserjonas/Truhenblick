/**
 * Einheiten für die Mengenangabe.
 * `schritt` ist der Betrag, um den die −/+-Knöpfe die Menge ändern.
 */

export interface Einheit {
  id: string;
  name: string;
  /** Mehrzahl, falls sie vom Namen abweicht */
  mehrzahl?: string;
  /** Kurzform für enge Stellen */
  kurz: string;
  schritt: number;
  /** Gewichtsangabe statt Stückzahl – wird auch in den Chips mit Einheit gezeigt */
  gewicht?: boolean;
}

export const EINHEITEN: Einheit[] = [
  { id: 'stueck', name: 'Stück', kurz: 'Stk.', schritt: 1 },
  { id: 'packung', name: 'Packung', mehrzahl: 'Packungen', kurz: 'Pkg.', schritt: 1 },
  { id: 'beutel', name: 'Beutel', kurz: 'Btl.', schritt: 1 },
  { id: 'portion', name: 'Portion', mehrzahl: 'Portionen', kurz: 'Port.', schritt: 1 },
  { id: 'g', name: 'g', kurz: 'g', schritt: 100, gewicht: true },
  { id: 'kg', name: 'kg', kurz: 'kg', schritt: 0.5, gewicht: true },
];

export const STANDARD_EINHEIT = 'stueck';

const NACH_ID = new Map(EINHEITEN.map((e) => [e.id, e]));

export function einheitInfo(id: string): Einheit {
  return NACH_ID.get(id) ?? (NACH_ID.get(STANDARD_EINHEIT) as Einheit);
}

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export function zahlAnzeige(n: number): string {
  return ZAHL.format(n);
}

/**
 * Für die Chips in der Truhengrafik, wo jeder Millimeter zählt:
 * Gewichte mit Einheit („500 g“), alles Zählbare nur als Anzahl („2×“).
 */
export function mengeKurz(menge: number, einheit: string): string {
  const e = einheitInfo(einheit);
  return e.gewicht ? `${ZAHL.format(menge)} ${e.kurz}` : `${ZAHL.format(menge)}×`;
}

/** „2 Stück“, „3 Packungen“ … – ausgeschrieben */
export function mengeLang(menge: number, einheit: string): string {
  const e = einheitInfo(einheit);
  return `${ZAHL.format(menge)} ${menge !== 1 && e.mehrzahl ? e.mehrzahl : e.name}`;
}
