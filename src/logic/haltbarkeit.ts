import type { Artikel } from '../../shared/types.ts';
import { BALD_VERBRAUCHEN_TAGE } from '../config/ampel.ts';
import { kategorieInfo } from '../config/kategorien.ts';
import { addMonate, tageZwischen } from './datum.ts';

export type Status = 'frisch' | 'bald' | 'ueberfaellig';

export const STATUS_NAME: Record<Status, string> = {
  frisch: 'frisch',
  bald: 'bald verbrauchen',
  ueberfaellig: 'überfällig',
};

/** Reihenfolge für Sortierungen: Dringendes zuerst. */
export const STATUS_RANG: Record<Status, number> = { ueberfaellig: 0, bald: 1, frisch: 2 };

type Haltbarkeitsangaben = Pick<Artikel, 'haltbarBis' | 'eingefrorenAm' | 'kategorie'>;

/** Eingetragenes Datum, sonst Einfrierdatum + Standardhaltbarkeit der Kategorie. */
export function haltbarBisEffektiv(artikel: Haltbarkeitsangaben): string {
  return artikel.haltbarBis ?? addMonate(artikel.eingefrorenAm, kategorieInfo(artikel.kategorie).haltbarMonate);
}

/** Tage bis zum Ablauf; negativ = überfällig. */
export function resttage(artikel: Haltbarkeitsangaben, heute: string): number {
  return tageZwischen(heute, haltbarBisEffektiv(artikel));
}

export function statusAusResttagen(rest: number, baldTage: number = BALD_VERBRAUCHEN_TAGE): Status {
  if (rest < 0) return 'ueberfaellig';
  if (rest <= baldTage) return 'bald';
  return 'frisch';
}

export function statusVon(artikel: Haltbarkeitsangaben, heute: string): Status {
  return statusAusResttagen(resttage(artikel, heute));
}

function monate(tage: number): number {
  return Math.max(1, Math.round(tage / 30.44));
}

/** „noch 12 Tage“, „noch 5 Monate“, „heute fällig“, „seit 3 Tagen überfällig“ */
export function restText(rest: number): string {
  if (rest === 0) return 'heute fällig';
  if (rest > 0) {
    if (rest === 1) return 'noch 1 Tag';
    if (rest <= 60) return `noch ${rest} Tage`;
    return `noch ${monate(rest)} Monate`;
  }
  const seit = -rest;
  if (seit === 1) return 'seit 1 Tag überfällig';
  if (seit <= 60) return `seit ${seit} Tagen überfällig`;
  return `seit ${monate(seit)} Monaten überfällig`;
}

/** „3 Monate“ / „1 Monat“ – für den Hinweis am Haltbarkeitsfeld */
export function monateText(anzahl: number): string {
  return anzahl === 1 ? '1 Monat' : `${anzahl} Monate`;
}
