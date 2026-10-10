import { BALD_VERBRAUCHEN_TAGE } from './config/ampel.ts';
import { mengeLang } from './config/einheiten.ts';
import { haltbarBisEffektiv, restText, statusAusResttagen } from './haltbarkeit.ts';
import { tageZwischen } from './datum.ts';
import type { Artikel, Bereich } from './types.ts';

/**
 * Übersicht einer Truhe für andere Programme – gedacht für Home Assistant
 * (GET /api/uebersicht). Die Feldnamen sind bewusst ohne Umlaute, damit sie
 * sich in Vorlagen bequem ansprechen lassen.
 */
export interface Uebersicht {
  /** Zeitpunkt der Berechnung (UTC) */
  stand: string;
  /** Der Tag, für den gerechnet wurde (JJJJ-MM-TT) */
  heute: string;
  /** Ab so vielen Resttagen gilt ein Artikel als „bald fällig“ */
  schwelle_tage: number;
  /** Alle Artikel in der Truhe */
  artikel: number;
  frisch: number;
  /** läuft innerhalb der Schwelle ab */
  bald: number;
  /** Haltbarkeit überschritten */
  ueberfaellig: number;
  /** bald + ueberfaellig: das, was zuerst weg sollte */
  faellig: number;
  /** Kurzfassung, z. B. „3 bald fällig, 1 überfällig“ */
  text: string;
  /** Der Artikel, der als Nächstes abläuft oder am längsten überfällig ist */
  naechster: FaelligerArtikel | null;
  /** Überfällige und bald fällige Artikel, Dringendes zuerst */
  liste: FaelligerArtikel[];
  /** true, wenn es mehr fällige Artikel gibt, als `liste` zeigt */
  gekuerzt: boolean;
}

export interface FaelligerArtikel {
  name: string;
  emoji: string;
  kategorie: string;
  /** ausgeschrieben, z. B. „2 Packungen“ */
  menge: string;
  /** z. B. „Oben › Links“ */
  ort: string;
  haltbar_bis: string;
  /** Tage bis zum Ablauf; negativ = so viele Tage überfällig */
  tage: number;
  status: 'bald' | 'ueberfaellig' | 'frisch';
  /** z. B. „noch 6 Tage“ oder „4 Tage überfällig“ */
  text: string;
}

export interface UebersichtOptionen {
  /** Schwelle für „bald fällig“ in Tagen (Standard: wie in der App) */
  tage?: number;
  /** Höchstzahl der Einträge in `liste` */
  limit?: number;
  jetzt?: Date;
}

function mehrzahl(n: number, einzahl: string, mehr: string): string {
  return `${n} ${n === 1 ? einzahl : mehr}`;
}

/** Berechnet die Übersicht aus dem Bestand einer Truhe. `heute` im Format JJJJ-MM-TT. */
export function berechneUebersicht(
  bereiche: readonly Bereich[],
  artikel: readonly Artikel[],
  heute: string,
  { tage = BALD_VERBRAUCHEN_TAGE, limit = 20, jetzt = new Date() }: UebersichtOptionen = {},
): Uebersicht {
  const aktiveBereiche = new Map(bereiche.filter((b) => !b.geloeschtAm).map((b) => [b.id, b]));
  const ortVon = (a: Artikel): string => {
    const b = aktiveBereiche.get(a.bereichId);
    if (!b) return 'Nicht zugeordnet';
    const eltern = b.typ === 'fach' && b.parentId ? aktiveBereiche.get(b.parentId) : undefined;
    return eltern ? `${eltern.name} › ${b.name}` : b.name;
  };

  const alle: FaelligerArtikel[] = artikel
    .filter((a) => !a.geloeschtAm)
    .map((a) => {
      const haltbarBis = haltbarBisEffektiv(a);
      const rest = tageZwischen(heute, haltbarBis);
      return {
        name: a.name,
        emoji: a.emoji,
        kategorie: a.kategorie,
        menge: mengeLang(a.menge, a.einheit),
        ort: ortVon(a),
        haltbar_bis: haltbarBis,
        tage: rest,
        status: statusAusResttagen(rest, tage),
        text: restText(rest),
      };
    })
    .sort((x, y) => x.tage - y.tage || x.name.localeCompare(y.name, 'de'));

  const ueberfaellig = alle.filter((a) => a.status === 'ueberfaellig').length;
  const bald = alle.filter((a) => a.status === 'bald').length;
  const faellige = alle.filter((a) => a.status !== 'frisch');

  const teile: string[] = [];
  if (bald > 0) teile.push(`${bald} bald fällig`);
  if (ueberfaellig > 0) teile.push(`${ueberfaellig} überfällig`);
  const text =
    teile.length > 0
      ? teile.join(', ')
      : alle.length === 0
        ? 'Die Truhe ist leer'
        : `Alles frisch (${mehrzahl(alle.length, 'Artikel', 'Artikel')})`;

  return {
    stand: jetzt.toISOString(),
    heute,
    schwelle_tage: tage,
    artikel: alle.length,
    frisch: alle.length - faellige.length,
    bald,
    ueberfaellig,
    faellig: faellige.length,
    text,
    naechster: alle[0] ?? null,
    liste: faellige.slice(0, limit),
    gekuerzt: faellige.length > limit,
  };
}

/** Heutiges Datum (JJJJ-MM-TT) in einer Zeitzone wie „Europe/Berlin“. Wirft bei unbekannter Zeitzone. */
export function heuteIn(zeitzone: string, jetzt: Date = new Date()): string {
  // Das Format „en-CA“ schreibt Daten als JJJJ-MM-TT.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zeitzone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt);
}
