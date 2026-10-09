import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eingehendeGewinnt } from '../../shared/sync.ts';
import type { Artikel, Bereich, SyncDoc } from '../../shared/types.ts';
import { db } from '../db/db.ts';
import { artikelAendern, artikelAnlegen, artikelEntnehmen, bereichAnlegen } from '../db/repo.ts';
import { entferneKonfig, normalisiereUrl, speichereKonfig, SyncFehler, synchronisiere, type Sende } from './client.ts';

/** Server im Speicher mit demselben Protokoll wie das echte Backend. */
function testServer() {
  type Zeile<T> = { doc: T; rev: number };
  const tabellen = { bereiche: new Map<string, Zeile<Bereich>>(), artikel: new Map<string, Zeile<Artikel>>() };
  let rev = 0;
  let serverId = 'server-1';
  let anfragen = 0;

  function nimm<T extends SyncDoc>(tabelle: Map<string, Zeile<T>>, docs: T[]) {
    for (const doc of docs) {
      if (eingehendeGewinnt(tabelle.get(doc.id)?.doc, doc)) tabelle.set(doc.id, { doc, rev: ++rev });
    }
  }
  const seitRev = <T>(tabelle: Map<string, Zeile<T>>, seit: number) =>
    [...tabelle.values()].filter((z) => z.rev > seit).map((z) => z.doc);

  const sende: Sende = async (_konfig, anfrage) => {
    anfragen += 1;
    const vorher = rev;
    nimm(tabellen.bereiche, anfrage.bereiche);
    nimm(tabellen.artikel, anfrage.artikel);
    const seit = anfrage.seit > vorher ? 0 : anfrage.seit;
    return {
      serverId,
      rev,
      bereiche: structuredClone(seitRev(tabellen.bereiche, seit)),
      artikel: structuredClone(seitRev(tabellen.artikel, seit)),
    };
  };

  return {
    sende,
    /** Änderung eines anderen Geräts */
    vonAnderemGeraet(artikel: Artikel) {
      nimm(tabellen.artikel, [artikel]);
    },
    artikel: (id: string) => tabellen.artikel.get(id)?.doc,
    anzahl: () => tabellen.bereiche.size + tabellen.artikel.size,
    anfragen: () => anfragen,
    neuAufsetzen() {
      tabellen.bereiche.clear();
      tabellen.artikel.clear();
      rev = 0;
      serverId = 'server-2';
    },
  };
}

async function hack(bereichId: string) {
  return artikelAnlegen({
    name: 'Hackfleisch',
    kategorie: 'fleisch',
    emoji: '🥩',
    menge: 2,
    einheit: 'packung',
    eingefrorenAm: '2026-10-09',
    haltbarBis: '2027-01-09',
    bereichId,
    notiz: '',
  });
}

const spaeter = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

beforeEach(async () => {
  await Promise.all([db.bereiche.clear(), db.artikel.clear(), db.meta.clear()]);
  await speichereKonfig({ url: 'https://truhe.example', token: 'geheim' });
});

describe('normalisiereUrl', () => {
  it('ergänzt https und entfernt /api und Schrägstriche', () => {
    expect(normalisiereUrl(' truhe.example.de/ ')).toBe('https://truhe.example.de');
    expect(normalisiereUrl('https://truhe.example.de/api/')).toBe('https://truhe.example.de');
    expect(normalisiereUrl('http://192.168.1.20:8080/api/sync')).toBe('http://192.168.1.20:8080');
    expect(normalisiereUrl('')).toBe('');
  });
});

describe('synchronisiere', () => {
  it('tut nichts ohne eingerichteten Server', async () => {
    await entferneKonfig();
    const server = testServer();
    expect(await synchronisiere(server.sende)).toBeNull();
    expect(server.anfragen()).toBe(0);
  });

  it('lädt lokale Änderungen hoch und hakt sie ab', async () => {
    const server = testServer();
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);

    expect(await synchronisiere(server.sende)).toEqual({ gesendet: 2, empfangen: 0 });
    expect(server.artikel(a.id)?.name).toBe('Hackfleisch');
    expect(server.artikel(a.id)).not.toHaveProperty('dirty');
    expect((await db.artikel.get(a.id))?.dirty).toBe(0);
    expect((await db.bereiche.get(korb.id))?.dirty).toBe(0);

    expect(await synchronisiere(server.sende)).toEqual({ gesendet: 0, empfangen: 0 });
  });

  it('holt Änderungen anderer Geräte', async () => {
    const server = testServer();
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);
    await synchronisiere(server.sende);

    server.vonAnderemGeraet({ ...a, menge: 7, geaendertAm: spaeter(a.geaendertAm, 1000) });
    server.vonAnderemGeraet({ ...a, id: 'neu', name: 'Erbsen', geaendertAm: spaeter(a.geaendertAm, 1000) });

    expect((await synchronisiere(server.sende))?.empfangen).toBe(2);
    expect((await db.artikel.get(a.id))?.menge).toBe(7);
    expect((await db.artikel.get('neu'))?.name).toBe('Erbsen');
    expect((await db.artikel.get('neu'))?.dirty).toBe(0);
  });

  it('lässt bei Konflikten die letzte Änderung gewinnen', async () => {
    const server = testServer();
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);
    const b = await hack(korb.id);
    await synchronisiere(server.sende);

    // a: lokal später geändert als auf dem anderen Gerät → lokal gewinnt
    server.vonAnderemGeraet({ ...a, menge: 9, geaendertAm: spaeter(a.geaendertAm, 1) });
    await artikelAendern(a.id, { menge: 4 });
    // b: lokal entnommen, auf dem anderen Gerät danach noch bearbeitet → Bearbeitung gewinnt
    await artikelEntnehmen(b.id);
    const lokalB = (await db.artikel.get(b.id))!;
    server.vonAnderemGeraet({ ...b, menge: 3, geaendertAm: spaeter(lokalB.geaendertAm, 5000) });

    await synchronisiere(server.sende);
    expect((await db.artikel.get(a.id))?.menge).toBe(4);
    expect(server.artikel(a.id)?.menge).toBe(4);
    const nachher = (await db.artikel.get(b.id))!;
    expect(nachher.geloeschtAm).toBeNull();
    expect(nachher.menge).toBe(3);
    expect(nachher.dirty).toBe(0);
  });

  it('merkt Änderungen, die während des Abgleichs entstehen, weiter vor', async () => {
    const server = testServer();
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);

    const mitAenderung: Sende = async (konfig, anfrage) => {
      const antwort = await server.sende(konfig, anfrage);
      await artikelAendern(a.id, { menge: 11 });
      return antwort;
    };
    await synchronisiere(mitAenderung);
    expect((await db.artikel.get(a.id))?.dirty).toBe(1);
    expect((await db.artikel.get(a.id))?.menge).toBe(11);

    await synchronisiere(server.sende);
    expect(server.artikel(a.id)?.menge).toBe(11);
    expect((await db.artikel.get(a.id))?.dirty).toBe(0);
  });

  it('behält Änderungen vorgemerkt, wenn der Server nicht erreichbar ist', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);
    const kaputt: Sende = async () => {
      throw new SyncFehler('netz', 'Der Server ist nicht erreichbar.');
    };
    await expect(synchronisiere(kaputt)).rejects.toThrow(SyncFehler);
    expect((await db.artikel.get(a.id))?.dirty).toBe(1);
  });

  it('lädt alles erneut hoch, wenn der Server neu aufgesetzt wurde', async () => {
    const server = testServer();
    const korb = await bereichAnlegen('Korb', 'korb');
    await hack(korb.id);
    await synchronisiere(server.sende);
    expect(server.anzahl()).toBe(2);

    server.neuAufsetzen();
    expect(server.anzahl()).toBe(0);
    await synchronisiere(server.sende);
    expect(server.anzahl()).toBe(2);
    expect(await db.artikel.where('dirty').equals(1).count()).toBe(0);
  });

  it('übernimmt keine ungültigen Datensätze vom Server', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    const a = await hack(korb.id);
    const boese: Sende = async () => ({
      serverId: 'x',
      rev: 1,
      bereiche: [],
      artikel: [{ ...a, id: 'kaputt', menge: 'viel' } as unknown as Artikel],
    });
    await synchronisiere(boese);
    expect(await db.artikel.get('kaputt')).toBeUndefined();
  });
});
