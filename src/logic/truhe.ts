import type { Artikel, Bereich, BereichTyp } from '../../shared/types.ts';

export interface EbeneMitFaechern {
  ebene: Bereich;
  faecher: Bereich[];
}

export interface TruhenStruktur {
  koerbe: Bereich[];
  ebenen: EbeneMitFaechern[];
}

function nachReihenfolge(a: Bereich, b: Bereich): number {
  return a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de');
}

/** Ordnet die (nicht gelöschten) Bereiche zur Truhe: Körbe oben, darunter Ebenen mit ihren Fächern. */
export function baueStruktur(bereiche: readonly Bereich[]): TruhenStruktur {
  const aktiv = bereiche.filter((b) => !b.geloeschtAm);
  const ebenenIds = new Set(aktiv.filter((b) => b.typ === 'ebene').map((b) => b.id));
  const koerbe = aktiv.filter((b) => b.typ === 'korb').sort(nachReihenfolge);
  const ebenen: EbeneMitFaechern[] = aktiv
    .filter((b) => b.typ === 'ebene')
    .sort(nachReihenfolge)
    .map((ebene) => ({
      ebene,
      faecher: aktiv.filter((b) => b.typ === 'fach' && b.parentId === ebene.id).sort(nachReihenfolge),
    }));
  // Fächer, deren Ebene fehlt (z. B. nach einem Abgleich), bleiben als eigene Zeile sichtbar.
  for (const fach of aktiv.filter((b) => b.typ === 'fach' && !(b.parentId && ebenenIds.has(b.parentId)))) {
    ebenen.push({ ebene: fach, faecher: [] });
  }
  return { koerbe, ebenen };
}

/** „Mitte › links“ für Fächer, sonst der Name. */
export function bereichPfad(bereich: Bereich, alle: readonly Bereich[]): string {
  if (bereich.typ === 'fach' && bereich.parentId) {
    const ebene = alle.find((b) => b.id === bereich.parentId && !b.geloeschtAm);
    if (ebene) return `${ebene.name} › ${bereich.name}`;
  }
  return bereich.name;
}

/** Kennung der Sammelkachel für Artikel, deren Bereich es nicht mehr gibt. */
export const OHNE_BEREICH = '__ohne__';

/** Gruppiert Artikel nach Bereich; Artikel ohne gültigen Bereich landen unter OHNE_BEREICH. */
export function artikelJeBereich(artikel: readonly Artikel[], bereiche: readonly Bereich[]): Map<string, Artikel[]> {
  const gueltig = new Set(bereiche.filter((b) => !b.geloeschtAm).map((b) => b.id));
  const map = new Map<string, Artikel[]>();
  for (const a of artikel) {
    if (a.geloeschtAm) continue;
    const schluessel = gueltig.has(a.bereichId) ? a.bereichId : OHNE_BEREICH;
    const liste = map.get(schluessel);
    if (liste) liste.push(a);
    else map.set(schluessel, [a]);
  }
  return map;
}

/** Anzahl Spalten, in denen die Fächer einer Ebene nebeneinander liegen. */
export function fachSpalten(anzahl: number): number {
  if (anzahl <= 3) return Math.max(1, anzahl);
  if (anzahl === 4) return 2;
  return 3;
}

export interface TruhenKonfig {
  koerbe: number;
  ebenen: number;
  faecherJeEbene: number;
}

export interface BereichEntwurf {
  name: string;
  typ: BereichTyp;
  reihenfolge: number;
  /** Index der Ebene im Entwurf, zu der ein Fach gehört */
  ebeneIndex: number | null;
}

const SEITEN: Record<number, string[]> = {
  1: [''],
  2: ['links', 'rechts'],
  3: ['links', 'Mitte', 'rechts'],
  4: ['hinten links', 'hinten rechts', 'vorne links', 'vorne rechts'],
};

export function korbNamen(anzahl: number): string[] {
  const seiten = SEITEN[anzahl];
  if (anzahl === 1) return ['Korb'];
  if (seiten && anzahl <= 3) return seiten.map((s) => `Korb ${s}`);
  return Array.from({ length: anzahl }, (_, i) => `Korb ${i + 1}`);
}

export function ebenenNamen(anzahl: number): string[] {
  if (anzahl === 1) return ['Boden'];
  if (anzahl === 2) return ['Oben', 'Boden'];
  if (anzahl === 3) return ['Oben', 'Mitte', 'Boden'];
  return Array.from({ length: anzahl }, (_, i) => (i === anzahl - 1 ? 'Boden' : `Ebene ${i + 1}`));
}

export function fachNamen(anzahl: number): string[] {
  if (anzahl <= 1) return [];
  const seiten = SEITEN[anzahl];
  if (seiten) return seiten.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return Array.from({ length: anzahl }, (_, i) => `Fach ${i + 1}`);
}

/** Erzeugt die Bereiche für den Einrichtungsassistenten. */
export function standardBereiche(konfig: TruhenKonfig): BereichEntwurf[] {
  const entwurf: BereichEntwurf[] = [];
  korbNamen(konfig.koerbe)
    .slice(0, konfig.koerbe)
    .forEach((name, i) => entwurf.push({ name, typ: 'korb', reihenfolge: i, ebeneIndex: null }));
  ebenenNamen(konfig.ebenen).forEach((name, e) => {
    entwurf.push({ name, typ: 'ebene', reihenfolge: e, ebeneIndex: null });
    fachNamen(konfig.faecherJeEbene).forEach((fach, f) =>
      entwurf.push({ name: fach, typ: 'fach', reihenfolge: f, ebeneIndex: e }),
    );
  });
  return entwurf;
}
