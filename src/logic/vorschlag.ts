import type { Artikel } from '../../shared/types.ts';
import { STANDARD_EINHEIT } from '../config/einheiten.ts';
import { kategorieInfo, STANDARD_KATEGORIE, STICHWOERTER, type Stichwort } from '../config/kategorien.ts';

export interface Vorschlag {
  kategorie: string;
  emoji: string;
  haltbarMonate: number;
  einheit: string;
  /** Woher der Vorschlag stammt – „historie“ = früher schon einmal so erfasst */
  quelle: 'historie' | 'stichwort' | 'standard';
}

/** Kleinschreibung, Umlaute und Akzente vereinheitlicht. */
export function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function woerterAus(text: string): string[] {
  return normalisiere(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Übliche Endungen (Erbse/Erbsen, Brot/Brote, Steak/Steaks) zählen nicht. */
const ENDUNG = '(?:e|n|en|er|s|es)?';

interface Muster {
  stichwort: Stichwort;
  laenge: number;
  amEnde: RegExp;
  amAnfang: RegExp;
}

const MUSTER: Muster[] = STICHWOERTER.flatMap((stichwort) =>
  stichwort.woerter.map((wort) => {
    const w = normalisiere(wort).replace(/[^a-z0-9]/g, '');
    return {
      stichwort,
      laenge: w.length,
      amEnde: new RegExp(`${w}${ENDUNG}$`),
      amAnfang: new RegExp(`^${w}`),
    };
  }),
);

function findeStichwort(name: string): Stichwort | null {
  let bestes: { stichwort: Stichwort; rang: number; laenge: number } | null = null;
  for (const wort of woerterAus(name)) {
    for (const m of MUSTER) {
      // Bei zusammengesetzten Wörtern bestimmt das Ende die Bedeutung (Erbsen-suppe).
      const rang = m.amEnde.test(wort) ? 2 : m.amAnfang.test(wort) ? 1 : 0;
      if (rang === 0) continue;
      if (!bestes || rang > bestes.rang || (rang === bestes.rang && m.laenge > bestes.laenge)) {
        bestes = { stichwort: m.stichwort, rang, laenge: m.laenge };
      }
    }
  }
  return bestes?.stichwort ?? null;
}

type Frueher = Pick<Artikel, 'name' | 'kategorie' | 'emoji' | 'einheit' | 'geaendertAm'>;

/**
 * Schlägt Kategorie, Emoji, Haltbarkeit und Einheit für einen Artikelnamen vor.
 * Wurde derselbe Name schon einmal erfasst, werden Kategorie, Emoji und Einheit
 * von dort übernommen.
 */
export function vorschlagFuer(name: string, historie: readonly Frueher[] = []): Vorschlag {
  const gesucht = normalisiere(name).trim();
  const stichwort = gesucht ? findeStichwort(name) : null;

  if (gesucht) {
    let frueher: Frueher | null = null;
    for (const a of historie) {
      if (normalisiere(a.name).trim() !== gesucht) continue;
      if (!frueher || a.geaendertAm > frueher.geaendertAm) frueher = a;
    }
    if (frueher) {
      const gleicheKategorie = stichwort?.kategorie === frueher.kategorie;
      return {
        kategorie: frueher.kategorie,
        emoji: frueher.emoji,
        haltbarMonate:
          (gleicheKategorie ? stichwort?.haltbarMonate : undefined) ?? kategorieInfo(frueher.kategorie).haltbarMonate,
        einheit: frueher.einheit,
        quelle: 'historie',
      };
    }
  }

  if (stichwort) {
    const kategorie = kategorieInfo(stichwort.kategorie);
    return {
      kategorie: kategorie.id,
      emoji: stichwort.emoji ?? kategorie.emoji,
      haltbarMonate: stichwort.haltbarMonate ?? kategorie.haltbarMonate,
      einheit: STANDARD_EINHEIT,
      quelle: 'stichwort',
    };
  }

  const standard = kategorieInfo(STANDARD_KATEGORIE);
  return {
    kategorie: standard.id,
    emoji: standard.emoji,
    haltbarMonate: standard.haltbarMonate,
    einheit: STANDARD_EINHEIT,
    quelle: 'standard',
  };
}
