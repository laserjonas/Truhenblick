import type { Artikel } from '../../shared/types.ts';
import { kategorieInfo } from '../config/kategorien.ts';
import { haltbarBisEffektiv } from './haltbarkeit.ts';
import { normalisiere } from './vorschlag.ts';

/**
 * Findet Artikel, bei denen jedes Suchwort in Name, Notiz oder Kategorie vorkommt.
 * Treffer im Namen stehen vorne, Treffer am Namensanfang ganz vorne.
 */
export function sucheArtikel(artikel: readonly Artikel[], anfrage: string): Artikel[] {
  const woerter = normalisiere(anfrage).split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return [];

  const treffer: { artikel: Artikel; rang: number }[] = [];
  for (const a of artikel) {
    const name = normalisiere(a.name);
    const rest = normalisiere(`${a.notiz} ${kategorieInfo(a.kategorie).name}`);
    let rang = 0;
    let passt = true;
    for (const w of woerter) {
      if (name.startsWith(w)) rang += 3;
      else if (name.includes(w)) rang += 2;
      else if (rest.includes(w)) rang += 1;
      else {
        passt = false;
        break;
      }
    }
    if (passt) treffer.push({ artikel: a, rang });
  }
  return treffer
    .sort((x, y) => y.rang - x.rang || x.artikel.name.localeCompare(y.artikel.name, 'de'))
    .map((t) => t.artikel);
}

export type Sortierung = 'ablauf' | 'name' | 'eingefroren' | 'kategorie' | 'bereich';

/** Sortiert eine Kopie der Liste; `bereichName` liefert den Anzeigenamen des Bereichs. */
export function sortiereArtikel(
  artikel: readonly Artikel[],
  sortierung: Sortierung,
  bereichName: (a: Artikel) => string = () => '',
): Artikel[] {
  const nachName = (a: Artikel, b: Artikel) => a.name.localeCompare(b.name, 'de');
  const vergleich: Record<Sortierung, (a: Artikel, b: Artikel) => number> = {
    name: nachName,
    ablauf: (a, b) => haltbarBisEffektiv(a).localeCompare(haltbarBisEffektiv(b)) || nachName(a, b),
    eingefroren: (a, b) => a.eingefrorenAm.localeCompare(b.eingefrorenAm) || nachName(a, b),
    kategorie: (a, b) =>
      kategorieInfo(a.kategorie).name.localeCompare(kategorieInfo(b.kategorie).name, 'de') || nachName(a, b),
    bereich: (a, b) => bereichName(a).localeCompare(bereichName(b), 'de') || nachName(a, b),
  };
  return [...artikel].sort(vergleich[sortierung]);
}
