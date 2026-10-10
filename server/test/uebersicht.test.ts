import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { addMonate, heuteIso } from '../../shared/datum.ts';
import type { Artikel, Bereich } from '../../shared/types.ts';
import type { Uebersicht } from '../../shared/uebersicht.ts';
import { erstelleApp } from '../src/app.ts';
import { oeffneSpeicher, type Speicher } from '../src/speicher.ts';

const CODE = 'ein-ausreichend-langes-test-token';
const T = '2026-10-09T08:00:00.000Z';
const HEUTE = heuteIso();
/** Datum relativ zu heute, damit die Tests an jedem Tag dasselbe ergeben. */
const inTagen = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return heuteIso(d);
};

let speicher: Speicher;
let app: ReturnType<typeof erstelleApp>;

const mit = (schluessel: string | null) => (schluessel ? { Authorization: `Bearer ${schluessel}` } : undefined);

function artikel(name: string, haltbarBis: string, teil: Partial<Artikel> = {}): Artikel {
  return {
    id: name,
    name,
    kategorie: 'fleisch',
    emoji: '🥩',
    menge: 2,
    einheit: 'packung',
    eingefrorenAm: addMonate(HEUTE, -3),
    haltbarBis,
    bereichId: 'korb',
    notiz: 'nur für uns',
    erstelltAm: T,
    geaendertAm: T,
    geloeschtAm: null,
    ...teil,
  };
}

async function fuelle(code = CODE) {
  const korb: Bereich = { id: 'korb', name: 'Korb links', typ: 'korb', reihenfolge: 0, parentId: null, geaendertAm: T, geloeschtAm: null };
  const antwort = await app.request('/api/sync', {
    method: 'POST',
    headers: { ...mit(code), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seit: 0,
      bereiche: [korb],
      artikel: [artikel('Erbsen', inTagen(300)), artikel('Bratwürste', inTagen(6)), artikel('Brötchen', inTagen(-4)), artikel('Entnommen', inTagen(-9), { geloeschtAm: T })],
    }),
  });
  assert.equal(antwort.status, 200);
}

async function uebersicht(schluessel: string | null, abfrage = '', zeitzone = true): Promise<Response> {
  // Mit der Zeitzone des Testrechners gerechnet, damit „heute“ zu den Testdaten passt.
  const tz = zeitzone ? `zeitzone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}` : '';
  const q = [tz, abfrage].filter(Boolean).join('&');
  return app.request(`/api/uebersicht${q ? `?${q}` : ''}`, { headers: mit(schluessel) });
}

async function neuerSchluessel(code = CODE): Promise<string> {
  const antwort = await app.request('/api/lesezugang', { method: 'POST', headers: mit(code) });
  assert.equal(antwort.status, 200);
  return ((await antwort.json()) as { schluessel: string }).schluessel;
}

beforeEach(() => {
  speicher = oeffneSpeicher(':memory:');
  app = erstelleApp({ speicher, token: CODE, melde: () => {} });
});
afterEach(() => speicher.schliessen());

describe('Übersicht (GET /api/uebersicht)', () => {
  it('liefert Zähler und die Liste des Fälligen', async () => {
    await fuelle();
    const antwort = await uebersicht(CODE);
    assert.equal(antwort.status, 200);
    assert.equal(antwort.headers.get('Cache-Control'), 'no-store');
    const u = (await antwort.json()) as Uebersicht;

    assert.deepEqual(
      { artikel: u.artikel, frisch: u.frisch, bald: u.bald, ueberfaellig: u.ueberfaellig, faellig: u.faellig, text: u.text },
      { artikel: 3, frisch: 1, bald: 1, ueberfaellig: 1, faellig: 2, text: '1 bald fällig, 1 überfällig' },
    );
    assert.deepEqual(u.liste.map((a) => [a.name, a.tage, a.status, a.text, a.menge, a.ort]), [
      ['Brötchen', -4, 'ueberfaellig', '4 Tage überfällig', '2 Packungen', 'Korb links'],
      ['Bratwürste', 6, 'bald', 'noch 6 Tage', '2 Packungen', 'Korb links'],
    ]);
    assert.equal(u.naechster?.name, 'Brötchen');
    assert.equal(u.heute, HEUTE);
  });

  it('gibt keine Notizen und keine internen Kennungen heraus', async () => {
    await fuelle();
    const text = await (await uebersicht(CODE)).text();
    assert.ok(!text.includes('nur für uns'));
    assert.ok(!text.includes('bereichId'));
  });

  it('verlangt eine Anmeldung', async () => {
    assert.equal((await uebersicht(null)).status, 401);
    assert.equal((await uebersicht('falsch')).status, 401);
  });

  it('nimmt Schwelle und Länge der Liste entgegen', async () => {
    await fuelle();
    const eng = (await (await uebersicht(CODE, 'tage=3')).json()) as Uebersicht;
    assert.deepEqual([eng.schwelle_tage, eng.bald, eng.liste.map((a) => a.name)], [3, 0, ['Brötchen']]);
    const kurz = (await (await uebersicht(CODE, 'limit=1')).json()) as Uebersicht;
    assert.deepEqual([kurz.liste.length, kurz.gekuerzt, kurz.faellig], [1, true, 2]);
  });

  it('weist unbrauchbare Angaben ab', async () => {
    assert.equal((await uebersicht(CODE, 'tage=viele')).status, 400);
    assert.equal((await uebersicht(CODE, 'limit=-1')).status, 400);
    assert.equal((await app.request('/api/uebersicht?zeitzone=Mond/Krater', { headers: mit(CODE) })).status, 400);
  });

  it('rechnet ohne Angabe mit der Zeitzone des Servers und mit Angabe in der gewünschten', async () => {
    assert.equal((await uebersicht(CODE, '', false)).status, 200);
    const tokio = (await (await app.request('/api/uebersicht?zeitzone=Asia/Tokyo', { headers: mit(CODE) })).json()) as Uebersicht;
    assert.match(tokio.heute, /^\d{4}-\d\d-\d\d$/);
  });
});

describe('Lese-Schlüssel', () => {
  it('öffnet die Übersicht – und sonst nichts', async () => {
    await fuelle();
    const schluessel = await neuerSchluessel();
    assert.match(schluessel, /^lese-[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){4}$/);

    const u = (await (await uebersicht(schluessel)).json()) as Uebersicht;
    assert.equal(u.faellig, 2);

    const leer = JSON.stringify({ seit: 0, bereiche: [], artikel: [] });
    const kopf = { ...mit(schluessel), 'Content-Type': 'application/json' };
    assert.equal((await app.request('/api/sync', { method: 'POST', headers: kopf, body: leer })).status, 401);
    assert.equal((await app.request('/api/code', { method: 'POST', headers: kopf })).status, 401);
    assert.equal((await app.request('/api/update', { headers: kopf })).status, 401);
    assert.equal((await app.request('/api/lesezugang', { method: 'POST', headers: kopf })).status, 401);
    assert.equal((await app.request('/api/lesezugang', { method: 'DELETE', headers: kopf })).status, 401);
  });

  it('gehört zu genau einer Truhe', async () => {
    await fuelle();
    const andere = ((await (await app.request('/api/truhen', { method: 'POST' })).json()) as { code: string }).code;
    const schluesselAndere = await neuerSchluessel(andere);
    const u = (await (await uebersicht(schluesselAndere)).json()) as Uebersicht;
    assert.deepEqual([u.artikel, u.text], [0, 'Die Truhe ist leer']);
  });

  it('lässt sich nur mit dem Zugangscode erzeugen', async () => {
    assert.equal((await app.request('/api/lesezugang', { method: 'POST' })).status, 401);
    assert.equal((await app.request('/api/lesezugang', { method: 'POST', headers: mit('falsch') })).status, 401);
  });

  it('wird durch einen neuen ersetzt und lässt sich widerrufen', async () => {
    const aktiv = async () => ((await (await app.request('/api/lesezugang', { headers: mit(CODE) })).json()) as { aktiv: boolean }).aktiv;
    assert.equal(await aktiv(), false);

    const erster = await neuerSchluessel();
    assert.equal(await aktiv(), true);
    const zweiter = await neuerSchluessel();
    assert.equal((await uebersicht(erster)).status, 401);
    assert.equal((await uebersicht(zweiter)).status, 200);

    const weg = await app.request('/api/lesezugang', { method: 'DELETE', headers: mit(CODE) });
    assert.deepEqual(await weg.json(), { aktiv: false });
    assert.equal((await uebersicht(zweiter)).status, 401);
    assert.equal(await aktiv(), false);
    // Der Zugangscode selbst bleibt gültig.
    assert.equal((await uebersicht(CODE)).status, 200);
  });

  it('bleibt gültig, wenn der Zugangscode der Truhe erneuert wird', async () => {
    const schluessel = await neuerSchluessel();
    const { code } = (await (await app.request('/api/code', { method: 'POST', headers: mit(CODE) })).json()) as { code: string };
    assert.equal((await uebersicht(CODE)).status, 401);
    assert.equal((await uebersicht(code)).status, 200);
    assert.equal((await uebersicht(schluessel)).status, 200);
  });

  it('übersteht einen Neustart; gespeichert ist nur die Prüfsumme', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'tb-lese-'));
    const datei = join(ordner, 'truhenblick.sqlite');
    try {
      speicher.schliessen();
      speicher = oeffneSpeicher(datei);
      app = erstelleApp({ speicher, token: CODE, melde: () => {} });
      const schluessel = await neuerSchluessel();

      speicher.schliessen();
      const roh = new Database(datei, { readonly: true });
      const inhalt = JSON.stringify(roh.prepare('SELECT * FROM truhen').all());
      roh.close();
      assert.ok(!inhalt.includes(schluessel));

      speicher = oeffneSpeicher(datei);
      app = erstelleApp({ speicher, token: CODE, melde: () => {} });
      assert.equal((await uebersicht(schluessel)).status, 200);
    } finally {
      speicher.schliessen();
      rmSync(ordner, { recursive: true, force: true });
      speicher = oeffneSpeicher(':memory:');
    }
  });

  it('kommt mit einer Datenbank aus Version 0.3 zurecht (Spalte wird ergänzt)', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'tb-v2-'));
    const datei = join(ordner, 'truhenblick.sqlite');
    try {
      const alt = new Database(datei);
      alt.exec(`
        CREATE TABLE truhen (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, rev INTEGER NOT NULL DEFAULT 0, erstellt_am TEXT NOT NULL);
        CREATE TABLE docs (truhe TEXT NOT NULL, tabelle TEXT NOT NULL, id TEXT NOT NULL, geaendert_am TEXT NOT NULL, rev INTEGER NOT NULL, daten TEXT NOT NULL, PRIMARY KEY (truhe, tabelle, id));
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 2;
      `);
      alt.close();

      speicher.schliessen();
      speicher = oeffneSpeicher(datei);
      app = erstelleApp({ speicher, token: CODE, melde: () => {} });
      await fuelle();
      const schluessel = await neuerSchluessel();
      assert.equal(((await (await uebersicht(schluessel)).json()) as Uebersicht).faellig, 2);
    } finally {
      speicher.schliessen();
      rmSync(ordner, { recursive: true, force: true });
      speicher = oeffneSpeicher(':memory:');
    }
  });
});
