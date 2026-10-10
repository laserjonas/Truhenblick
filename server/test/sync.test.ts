import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Hono } from 'hono';
import type { Artikel, Bereich, SyncAntwort } from '../../shared/types.ts';
import { erstelleApp, erzeugeCode } from '../src/app.ts';
import { KonfigFehler, leseKonfig } from '../src/konfig.ts';
import { oeffneSpeicher, type Speicher } from '../src/speicher.ts';

const TOKEN = 'ein-ausreichend-langes-test-token';

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
let app: Hono;

function sende(koerper: unknown, token: string | null = TOKEN, kopf: Record<string, string> = {}) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...kopf },
    body: typeof koerper === 'string' ? koerper : JSON.stringify(koerper),
  });
}

async function sync(seit: number, bereiche: Bereich[] = [], artikelListe: Artikel[] = []): Promise<SyncAntwort> {
  const antwort = await sende({ seit, bereiche, artikel: artikelListe });
  assert.equal(antwort.status, 200);
  return (await antwort.json()) as SyncAntwort;
}

beforeEach(() => {
  speicher = oeffneSpeicher(':memory:');
  app = erstelleApp({ speicher, token: TOKEN, melde: () => {} });
});

afterEach(() => speicher.schliessen());

describe('Anmeldung', () => {
  it('lässt /api/health ohne Token zu', async () => {
    const antwort = await app.request('/api/health');
    assert.equal(antwort.status, 200);
    assert.deepEqual(await antwort.json(), { ok: true, app: 'truhenblick', version: 'dev' });
  });

  it('weist fehlende und falsche Tokens ab', async () => {
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [] }, null)).status, 401);
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [] }, 'falsch')).status, 401);
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [] })).status, 200);
  });

  it('sperrt eine Adresse nach zu vielen Fehlversuchen – andere bleiben unberührt', async () => {
    const boese = { 'X-Forwarded-For': '203.0.113.7' };
    for (let i = 0; i < 10; i++) assert.equal((await sende({}, 'falsch', boese)).status, 401);
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [] }, TOKEN, boese)).status, 429);
    assert.equal((await sende({ seit: 0, bereiche: [], artikel: [] }, TOKEN, { 'X-Forwarded-For': '198.51.100.1' })).status, 200);
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

describe('Zugangscode', () => {
  const LEER = { seit: 0, bereiche: [], artikel: [] };
  const FORM = /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){4}$/;

  async function neuerCode(token: string | null = TOKEN): Promise<Response> {
    return app.request('/api/code', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }

  it('erzeugt gut abtippbare, jedes Mal andere Codes', () => {
    const codes = new Set(Array.from({ length: 50 }, erzeugeCode));
    assert.equal(codes.size, 50);
    for (const code of codes) assert.match(code, FORM);
  });

  it('löst den bisherigen Code sofort ab', async () => {
    const antwort = await neuerCode();
    assert.equal(antwort.status, 200);
    const { code } = (await antwort.json()) as { code: string };
    assert.match(code, FORM);

    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.equal((await sende(LEER, code)).status, 200);
  });

  it('lässt sich nur mit dem gültigen Code erneuern', async () => {
    assert.equal((await neuerCode(null)).status, 401);
    assert.equal((await neuerCode('falsch')).status, 401);
    assert.equal(speicher.codeLesen(), null);
    assert.equal((await sende(LEER)).status, 200);
  });

  it('speichert auf dem Server nur eine Prüfsumme', async () => {
    const { code } = (await (await neuerCode()).json()) as { code: string };
    const abgelegt = speicher.codeLesen();
    assert.ok(abgelegt);
    assert.match(abgelegt.codeHash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(abgelegt).includes(code));
  });

  it('gilt nach einem Neustart des Servers weiter', async () => {
    const { code } = (await (await neuerCode()).json()) as { code: string };
    app = erstelleApp({ speicher, token: TOKEN, melde: () => {} });
    assert.equal((await sende(LEER, TOKEN)).status, 401);
    assert.equal((await sende(LEER, code)).status, 200);
  });

  it('weicht einem auf dem Server geänderten SYNC_TOKEN', async () => {
    const { code } = (await (await neuerCode()).json()) as { code: string };
    const NEU = 'vom-admin-neu-gesetztes-token';
    const meldungen: string[] = [];
    app = erstelleApp({ speicher, token: NEU, melde: (text) => meldungen.push(text) });

    assert.equal((await sende(LEER, NEU)).status, 200);
    assert.equal((await sende(LEER, code)).status, 401);
    assert.equal(speicher.codeLesen(), null);
    assert.match(meldungen.join(' '), /SYNC_TOKEN wurde geändert/);
  });
});

describe('Konfiguration', () => {
  it('verlangt ein ausreichend langes Token', () => {
    assert.throws(() => leseKonfig({}), KonfigFehler);
    assert.throws(() => leseKonfig({ SYNC_TOKEN: 'kurz' }), KonfigFehler);
    assert.equal(leseKonfig({ SYNC_TOKEN: TOKEN }).port, 3000);
  });

  it('liest Port, Datenverzeichnis und erlaubte Herkünfte', () => {
    const konfig = leseKonfig({ SYNC_TOKEN: TOKEN, PORT: '8080', CORS_ORIGIN: 'https://a.example/, https://b.example' });
    assert.equal(konfig.port, 8080);
    assert.deepEqual(konfig.corsOrigins, ['https://a.example', 'https://b.example']);
    assert.throws(() => leseKonfig({ SYNC_TOKEN: TOKEN, PORT: 'abc' }), KonfigFehler);
  });
});
