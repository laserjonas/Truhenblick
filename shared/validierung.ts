import type { Artikel, Bereich } from './types.ts';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function istText(x: unknown, max: number, min = 0): x is string {
  return typeof x === 'string' && x.length >= min && x.length <= max;
}

function istZeitstempel(x: unknown): x is string {
  return typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x));
}

function istDatum(x: unknown): x is string {
  return typeof x === 'string' && DATUM.test(x) && !Number.isNaN(Date.parse(x));
}

function istSyncDoc(x: Record<string, unknown>): boolean {
  return (
    istText(x.id, 64, 1) &&
    istZeitstempel(x.geaendertAm) &&
    (x.geloeschtAm === null || istZeitstempel(x.geloeschtAm))
  );
}

export function istBereich(x: unknown): x is Bereich {
  return (
    istObjekt(x) &&
    istSyncDoc(x) &&
    istText(x.name, 80, 1) &&
    (x.typ === 'korb' || x.typ === 'ebene' || x.typ === 'fach') &&
    typeof x.reihenfolge === 'number' &&
    Number.isFinite(x.reihenfolge) &&
    (x.parentId === null || istText(x.parentId, 64, 1))
  );
}

export function istArtikel(x: unknown): x is Artikel {
  return (
    istObjekt(x) &&
    istSyncDoc(x) &&
    istText(x.name, 120, 1) &&
    istText(x.kategorie, 40, 1) &&
    istText(x.emoji, 16) &&
    typeof x.menge === 'number' &&
    Number.isFinite(x.menge) &&
    x.menge >= 0 &&
    istText(x.einheit, 20, 1) &&
    istDatum(x.eingefrorenAm) &&
    (x.haltbarBis === null || istDatum(x.haltbarBis)) &&
    istText(x.bereichId, 64, 1) &&
    istText(x.notiz, 2000) &&
    istZeitstempel(x.erstelltAm)
  );
}

/** Übernimmt nur die bekannten Felder – unbekannte Zusätze werden verworfen. */
export function bereinigeBereich(b: Bereich): Bereich {
  return {
    id: b.id,
    name: b.name,
    typ: b.typ,
    reihenfolge: b.reihenfolge,
    parentId: b.parentId,
    geaendertAm: b.geaendertAm,
    geloeschtAm: b.geloeschtAm,
  };
}

export function bereinigeArtikel(a: Artikel): Artikel {
  return {
    id: a.id,
    name: a.name,
    kategorie: a.kategorie,
    emoji: a.emoji,
    menge: a.menge,
    einheit: a.einheit,
    eingefrorenAm: a.eingefrorenAm,
    haltbarBis: a.haltbarBis,
    bereichId: a.bereichId,
    notiz: a.notiz,
    erstelltAm: a.erstelltAm,
    geaendertAm: a.geaendertAm,
    geloeschtAm: a.geloeschtAm,
  };
}
