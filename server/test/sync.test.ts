import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import type { Artikel, Bereich, SyncAntwort } from '../../shared/types.ts';
import { erstelleApp, erzeugeCode, type AppOptionen } from '../src/app.ts';
import { KonfigFehler, leseKonfig } from '../src/konfig.ts';
import { oeffneSpeicher, type Speicher } from '../src/speicher.ts';

const TOKEN = 'ein-ausreichend-langes-test-token';
const LEER = { seit: 0, bereiche: [], artikel: [] };
const FORM = /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){4}$/;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function bereich(id: string, geaendertAm: string, teil: Partial<Bereich> = {}): Bereich {
  return { id, name: `Bereich ${id}`, typ: 'korb', reihenfolge: 0, parentId: null, geaendertAm, geloeschtAm: null, ...teil };
}

function artikel(id: string, geaendertAm: string, teil: Partial<Artikel> = {}): Artikel {
  return {
    id,
    name: `Artikel ${id}`,
    kategorie: 'sonstiges',
    emoji: '📦',
    menge: 1,
    einheit: 'stueck',
    eingefrorenAm: '2026-10-01',
    haltbarBis: null,
    bereichId: 'b1',
    notiz: '',
    erstelltAm: '2026-10-01T08:00:00.000Z',
    geaendertAm,
    geloeschtAm: null,
    ...teil,
  };
}

let speicher: Speicher;
let app: ReturnType<typeof erstelleApp>;

/** Startet die App neu auf demselben Speicher – wie ein Neustart des Servers. */
function starte(optionen: Partial<AppOptionen> = {}) {
  app = erstelleApp({ speicher, token: TOKEN, melde: () => {}, ...optionen });
}

function sende(koerper: unknown, token: string | null = TOKEN, kopf: Record<string, string> = {}) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...kopf },
    body: typeof koerper === 'string' ? koerper : JSON.stringify(koerper),
  });
}

async function sync(seit: number, bereiche: Bereich[] = [], artikelListe: Artikel[] = [], token = TOKEN): Promise<SyncAntwort> {
  const antwort = await sende({ seit, bereiche, artikel: artikelListe }, token);
  assert.equal(antwort.status, 200);
  return (await antwort.json()) as SyncAntwort;
}

/** Legt über die Schnittstelle eine Truhe an und liefert ihren Code. */
async function neueTruhe(kopf: Record<string, string> = {}): Promise<string> {
  const antwort = await app.request('/api/truhen', { method: 'POST', headers: kopf });
  assert.equal(antwort.status, 201);
  return ((await antwort.json()) as { code: string }).code;
}

beforeEach(() => {
  speicher = oeffneSpeicher(':memory:');
  starte();
});

afterEach(() => speicher.schliessen());

describe('Zugang mit dem Code der Truhe', () => {
  it('lässt /api/health ohne Code zu', async () => {
    const antwort = await app.request('/api/health');
    assert.equal(antwort.status, 200);
    const { kennung, ...rest } = (await antwort.json()) as Record<string, unknown>;
    assert.deepEqual(rest, {
      ok: true,
      app: 'truhenblick',
      version: 'dev',
      neueTruhen: true,
      anmeldung: false,
      angemeldet: true,
      erreichbarkeit: 'heimnetz',
      adresse: null,
    });
    assert.match(String(kennung), /^[\w-]{12}$/);
  });

  it('weist fehlende und falsche Codes ab', async () => {
    assert.equal((await sende(LEER, null)).status, 401);
    assert.equal((await sende(LEER, 'falsch')).status, 401);
    assert.equal((await sende(LEER)).status, 200);
  });

  it('sperrt eine Adresse nach zu vielen Fehlversuchen – andere bleiben unberührt', async () => {
    const boese = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 10; i++) assert.equal((await sende({}, 'falsch', boese)).status, 401);
    assert.equal((await sende(LEER, TOKEN, boese)).status, 429);
    assert.equal((await sende(LEER, TOKEN, { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
  });
});

describe('Eingabeprüfung', () => {
  it('lehnt kaputtes JSON und fremde Formate ab', async () => {
    assert.equal((await sende('{kaputt')).status, 400);
    assert.equal((await sende({ seit: -1, bereiche: [], artikel: [] })).status, 400);
    assert.equal((await sende({ seit: 0, bereiche: 'x', artikel: [] })).status, 400);
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [{ id: 'a1' }] })).status, 400);
    assert.equal(speicher.stand().datensaetze, 0);
  });

  it('speichert keine unbekannten Felder', async () => {
    const mitZusatz = { ...artikel('a1', '2026-10-09T08:00:00.000Z'), dirty: 1, fremd: 'x' };
    await sync(0, [], [mitZusatz]);
    const { artikel: zurueck } = await sync(0);
    assert.deepEqual(Object.keys(zurueck[0] as object).sort(), Object.keys(artikel('a1', '')).sort());
  });
});

describe('Abgleich', () => {
  it('gibt einem zweiten Gerät alles, was das erste gesendet hat', async () => {
    const a = await sync(0, [bereich('b1', '2026-10-09T08:00:00.000Z')], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    assert.equal(a.rev, 2);

    const b = await sync(0);
    assert.equal(b.serverId, a.serverId);
    assert.deepEqual(b.bereiche.map((x) => x.id), ['b1']);
    assert.deepEqual(b.artikel.map((x) => x.id), ['a1']);
  });

  it('liefert nur Änderungen nach dem bekannten Stand', async () => {
    const erster = await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    await sync(erster.rev, [], [artikel('a2', '2026-10-09T09:00:00.000Z')]);
    const spaeter = await sync(erster.rev);
    assert.deepEqual(spaeter.artikel.map((x) => x.id), ['a2']);
    assert.deepEqual((await sync(spaeter.rev)).artikel, []);
  });

  it('lässt die letzte Änderung gewinnen – unabhängig von der Reihenfolge des Eintreffens', async () => {
    await sync(0, [], [artikel('a1', '2026-10-09T10:00:00.000Z', { menge: 5 })]);
    // Ein Gerät, das länger offline war, schickt eine ältere Änderung nach.
    const antwort = await sync(0, [], [artikel('a1', '2026-10-09T09:00:00.000Z', { menge: 1 })]);
    assert.equal(antwort.artikel[0]?.menge, 5);
    assert.equal(antwort.rev, 1);

    const neuer = await sync(antwort.rev, [], [artikel('a1', '2026-10-09T11:00:00.000Z', { menge: 3 })]);
    assert.equal(neuer.artikel[0]?.menge, 3);
    assert.equal(neuer.rev, 2);
  });

  it('verteilt Löschungen und lässt spätere Bearbeitungen sie aufheben', async () => {
    await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    await sync(0, [], [artikel('a1', '2026-10-09T09:00:00.000Z', { geloeschtAm: '2026-10-09T09:00:00.000Z' })]);
    assert.equal((await sync(0)).artikel[0]?.geloeschtAm, '2026-10-09T09:00:00.000Z');

    await sync(0, [], [artikel('a1', '2026-10-09T10:00:00.000Z')]);
    assert.equal((await sync(0)).artikel[0]?.geloeschtAm, null);
  });

  it('schickt alles, wenn ein Gerät einen höheren Stand kennt als der Server', async () => {
    await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    const antwort = await sync(999);
    assert.equal(antwort.rev, 1);
    assert.deepEqual(antwort.artikel.map((x) => x.id), ['a1']);
  });

  it('ändert den Stand nicht, wenn nichts Neues kommt', async () => {
    const doc = artikel('a1', '2026-10-09T08:00:00.000Z');
    const erster = await sync(0, [], [doc]);
    const zweiter = await sync(erster.rev, [], [doc]);
    assert.equal(zweiter.rev, erster.rev);
    assert.deepEqual(zweiter.artikel, []);
  });
});

describe('Truhen anlegen und beitreten', () => {
  it('vergibt beim Anlegen einen gut abtippbaren Code – ohne Anmeldung', async () => {
    const code = await neueTruhe();
    assert.match(code, FORM);
    assert.equal((await sende(LEER, code)).status, 200);
    assert.equal(speicher.anzahlTruhen(), 2);
  });

  it('hält die Daten verschiedener Truhen getrennt', async () => {
    const a = await neueTruhe();
    const b = await neueTruhe();
    const inA = await sync(0, [bereich('b1', '2026-10-09T08:00:00.000Z')], [artikel('a1', '2026-10-09T08:00:00.000Z')], a);
    // Dieselbe Kennung in einer anderen Truhe ist ein anderer Datensatz.
    const inB = await sync(0, [], [artikel('a1', '2026-10-09T09:00:00.000Z', { name: 'aus Truhe B' })], b);

    assert.notEqual(inA.serverId, inB.serverId);
    assert.equal(inB.rev, 1);
    assert.deepEqual(inB.bereiche, []);
    assert.equal((await sync(0, [], [], a)).artikel[0]?.name, 'Artikel a1');
    assert.equal((await sync(0, [], [], b)).artikel[0]?.name, 'aus Truhe B');
    assert.deepEqual((await sync(0)).artikel, []);
  });

  it('lässt ein zweites Gerät mit dem Code derselben Truhe beitreten', async () => {
    const code = await neueTruhe();
    const erstes = await sync(0, [bereich('b1', '2026-10-09T08:00:00.000Z')], [artikel('a1', '2026-10-09T08:00:00.000Z')], code);
    const zweites = await sync(0, [], [], code);
    assert.equal(zweites.serverId, erstes.serverId);
    assert.deepEqual(zweites.bereiche.map((x) => x.id), ['b1']);
    assert.deepEqual(zweites.artikel.map((x) => x.id), ['a1']);
  });

  it('kommt ohne SYNC_TOKEN aus: Die erste Truhe entsteht in der App', async () => {
    starte({ token: undefined });
    speicher.schliessen();
    speicher = oeffneSpeicher(':memory:');
    starte({ token: undefined });

    assert.equal(speicher.anzahlTruhen(), 0);
    assert.equal((await sende(LEER)).status, 401);
    const code = await neueTruhe();
    assert.equal((await sende(LEER, code)).status, 200);
    assert.equal(speicher.truheMitCode(sha(code))?.id, speicher.ersteTruhe()?.id);
  });

  it('lässt sich abschalten', async () => {
    starte({ neueTruhen: false });
    const antwort = await app.request('/api/truhen', { method: 'POST' });
    assert.equal(antwort.status, 403);
    assert.match(((await antwort.json()) as { fehler: string }).fehler, /keine neuen Truhen/);
    assert.equal(((await (await app.request('/api/health')).json()) as { neueTruhen: boolean }).neueTruhen, false);
    // Vorhandene Truhen arbeiten weiter.
    assert.equal((await sende(LEER)).status, 200);
  });

  it('achtet auf die Höchstzahl', async () => {
    starte({ maxTruhen: 2 });
    await neueTruhe();
    const antwort = await app.request('/api/truhen', { method: 'POST' });
    assert.equal(antwort.status, 403);
    assert.match(((await antwort.json()) as { fehler: string }).fehler, /Höchstzahl/);
    assert.equal(((await (await app.request('/api/health')).json()) as { neueTruhen: boolean }).neueTruhen, false);
  });

  it('bremst Massenanlagen von einer Adresse', async () => {
    starte({ maxTruhen: 100 });
    const von = { 'X-Forwarded-For': '203.0.113.9' };
    for (let i = 0; i < 5; i++) await neueTruhe(von);
    assert.equal((await app.request('/api/truhen', { method: 'POST', headers: von })).status, 429);
    await neueTruhe({ 'X-Forwarded-For': '198.51.100.2' });
  });
});

describe('Zugangscode', () => {
  async function neuerCode(token: string | null = TOKEN): Promise<Response> {
    return app.request('/api/code', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }

  it('erzeugt gut abtippbare, jedes Mal andere Codes', () => {
    const codes = new Set(Array.from({ length: 50 }, erzeugeCode));
    assert.equal(codes.size, 50);
    for (const code of codes) assert.match(code, FORM);
  });

  it('löst den bisherigen Code sofort ab – nur für diese Truhe', async () => {
    const andere = await neueTruhe();
    const antwort = await neuerCode();
    assert.equal(antwort.status, 200);
    const { code } = (await antwort.json()) as { code: string };
    assert.match(code, FORM);

    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.equal((await sende(LEER, code)).status, 200);
    assert.equal((await sende(LEER, andere)).status, 200);
  });

  it('lässt sich nur mit einem gültigen Code erneuern', async () => {
    assert.equal((await neuerCode(null)).status, 401);
    assert.equal((await neuerCode('falsch')).status, 401);
    assert.equal((await sende(LEER)).status, 200);
  });

  it('behält beim Wechsel des Codes die Daten der Truhe', async () => {
    await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    const { code } = (await (await neuerCode()).json()) as { code: string };
    assert.deepEqual((await sync(0, [], [], code)).artikel.map((x) => x.id), ['a1']);
  });

  it('gilt nach einem Neustart des Servers weiter', async () => {
    const { code } = (await (await neuerCode()).json()) as { code: string };
    starte();
    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.equal((await sende(LEER, code)).status, 200);
  });

  it('weicht einem auf dem Server geänderten SYNC_TOKEN', async () => {
    await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')]);
    const { code } = (await (await neuerCode()).json()) as { code: string };
    const NEU = 'vom-admin-neu-gesetztes-token';
    const meldungen: string[] = [];
    starte({ token: NEU, melde: (text) => meldungen.push(text) });

    assert.equal((await sende(LEER, code)).status, 401);
    // Dieselbe Truhe, derselbe Inhalt – nur der Code ist zurückgesetzt.
    assert.deepEqual((await sync(0, [], [], NEU)).artikel.map((x) => x.id), ['a1']);
    assert.equal(speicher.anzahlTruhen(), 1);
    assert.match(meldungen.join(' '), /SYNC_TOKEN gilt jetzt/);
  });

  it('setzt mit einem nachträglich eingetragenen SYNC_TOKEN die zuerst angelegte Truhe zurück', async () => {
    speicher.schliessen();
    speicher = oeffneSpeicher(':memory:');
    starte({ token: undefined });
    const erste = await neueTruhe();
    const zweite = await neueTruhe();
    await sync(0, [], [artikel('a1', '2026-10-09T08:00:00.000Z')], erste);

    starte({ token: TOKEN });
    assert.equal((await sende(LEER, erste)).status, 401);
    assert.deepEqual((await sync(0)).artikel.map((x) => x.id), ['a1']);
    assert.equal((await sende(LEER, zweite)).status, 200);
  });
});

describe('Datenbank aus Version 0.2 (ein Bestand, ein Code)', () => {
  let ordner: string;
  let datei: string;
  const ALTE_ID = '11111111-2222-3333-4444-555555555555';

  /** Legt eine Datenbank im früheren Aufbau an. */
  function alteDatenbank(meta: Record<string, string>) {
    const db = new Database(datei);
    db.exec(`
      CREATE TABLE docs (tabelle TEXT NOT NULL, id TEXT NOT NULL, geaendert_am TEXT NOT NULL, rev INTEGER NOT NULL, daten TEXT NOT NULL, PRIMARY KEY (tabelle, id));
      CREATE INDEX docs_rev ON docs (rev);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const doc = db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?, ?)');
    const b = bereich('b1', '2026-10-09T08:00:00.000Z');
    const a = artikel('a1', '2026-10-09T08:00:00.000Z');
    doc.run('bereiche', b.id, b.geaendertAm, 1, JSON.stringify(b));
    doc.run('artikel', a.id, a.geaendertAm, 2, JSON.stringify(a));
    const m = db.prepare('INSERT INTO meta VALUES (?, ?)');
    for (const [key, value] of Object.entries({ serverId: ALTE_ID, rev: '2', ...meta })) m.run(key, value);
    db.close();
  }

  beforeEach(() => {
    speicher.schliessen();
    ordner = mkdtempSync(join(tmpdir(), 'tb-alt-'));
    datei = join(ordner, 'truhenblick.sqlite');
  });
  afterEach(() => {
    speicher.schliessen();
    rmSync(ordner, { recursive: true, force: true });
    speicher = oeffneSpeicher(':memory:');
  });

  it('wird zur ersten Truhe: gleicher Code, gleiche Kennung, gleicher Stand', async () => {
    alteDatenbank({});
    speicher = oeffneSpeicher(datei);
    starte();

    const stand = await sync(2);
    // Verbundene Geräte merken nichts: Kennung und Zählerstand sind unverändert …
    assert.equal(stand.serverId, ALTE_ID);
    assert.equal(stand.rev, 2);
    assert.deepEqual(stand.artikel, []);
    // … und ein neues Gerät bekommt alles.
    const alles = await sync(0);
    assert.deepEqual(alles.bereiche.map((x) => x.id), ['b1']);
    assert.deepEqual(alles.artikel.map((x) => x.id), ['a1']);
    assert.equal(speicher.ersteTruhe()?.id, ALTE_ID);
  });

  it('behält einen in der App erzeugten Code', async () => {
    alteDatenbank({ code_hash: sha('in-der-app-erzeugter-code'), code_env_hash: sha(TOKEN) });
    speicher = oeffneSpeicher(datei);
    starte();

    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.deepEqual((await sync(0, [], [], 'in-der-app-erzeugter-code')).artikel.map((x) => x.id), ['a1']);
  });

  it('bleibt verschlossen, solange kein Code bekannt ist – und übersteht einen zweiten Start', async () => {
    alteDatenbank({});
    speicher = oeffneSpeicher(datei);
    starte({ token: undefined });
    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.equal(speicher.stand().datensaetze, 2);

    speicher.schliessen();
    speicher = oeffneSpeicher(datei);
    starte();
    assert.deepEqual((await sync(0)).artikel.map((x) => x.id), ['a1']);
  });
});

describe('Konfiguration', () => {
  it('kommt ohne SYNC_TOKEN aus, verlangt aber eine Mindestlänge, wenn er gesetzt ist', () => {
    assert.equal(leseKonfig({}).token, undefined);
    assert.throws(() => leseKonfig({ SYNC_TOKEN: 'kurz' }), KonfigFehler);
    assert.equal(leseKonfig({ SYNC_TOKEN: TOKEN }).token, TOKEN);
    assert.equal(leseKonfig({}).port, 3000);
  });

  it('liest Port, Datenverzeichnis und erlaubte Herkünfte', () => {
    const konfig = leseKonfig({ PORT: '8080', CORS_ORIGIN: 'https://a.example/, https://b.example' });
    assert.equal(konfig.port, 8080);
    assert.deepEqual(konfig.corsOrigins, ['https://a.example', 'https://b.example']);
    assert.throws(() => leseKonfig({ PORT: 'abc' }), KonfigFehler);
  });

  it('liest die Einstellungen für neue Truhen', () => {
    assert.deepEqual([leseKonfig({}).neueTruhen, leseKonfig({}).maxTruhen], [true, 10]);
    assert.equal(leseKonfig({ NEUE_TRUHEN: 'aus' }).neueTruhen, false);
    assert.equal(leseKonfig({ MAX_TRUHEN: '3' }).maxTruhen, 3);
    assert.throws(() => leseKonfig({ NEUE_TRUHEN: 'vielleicht' }), KonfigFehler);
    assert.throws(() => leseKonfig({ MAX_TRUHEN: '0' }), KonfigFehler);
  });
});
