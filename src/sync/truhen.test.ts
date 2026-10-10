import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db.ts';
import { bereichAnlegen } from '../db/repo.ts';
import { CODE_HINWEIS, entferneKonfig, ladeKonfig, legeTruheAn, merkeCodeHinweis, NICHT_DA, pruefeServer, speichereKonfig, SyncFehler } from './client.ts';

type Antwort = { status: number; body: unknown } | 'netzfehler';

/** Ersetzt fetch durch feste Antworten und merkt sich die Aufrufe. */
function stelleServer(antworten: Record<string, Antwort>) {
  const aufrufe: { url: string; methode: string; anmeldung: string | null }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const kopf = new Headers(init.headers);
    aufrufe.push({ url, methode: init.method ?? 'GET', anmeldung: kopf.get('Authorization') });
    const antwort = antworten[url];
    if (!antwort || antwort === 'netzfehler') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(antwort.body), { status: antwort.status, headers: { 'Content-Type': 'application/json' } });
  });
  return aufrufe;
}

beforeEach(async () => {
  await Promise.all([db.bereiche.clear(), db.artikel.clear(), db.meta.clear()]);
});
afterEach(() => vi.unstubAllGlobals());

describe('pruefeServer', () => {
  it('erkennt einen Truhenblick-Server und ob er neue Truhen annimmt', async () => {
    stelleServer({ '/api/health': { status: 200, body: { ok: true, app: 'truhenblick', version: '0.3.0', neueTruhen: true } } });
    expect(await pruefeServer('')).toMatchObject({ da: true, neueTruhen: true });
  });

  it('hält einen älteren Server für vorhanden, aber ohne neue Truhen', async () => {
    stelleServer({ 'https://alt.example/api/health': { status: 200, body: { ok: true, app: 'truhenblick', version: '0.2.1' } } });
    expect(await pruefeServer('https://alt.example')).toMatchObject({ da: true, neueTruhen: false, anmeldung: false, angemeldet: true });
  });

  it('meldet „nicht da“ bei fremden Antworten, Fehlern und ohne Netz – ohne zu werfen', async () => {
    stelleServer({
      '/api/health': { status: 200, body: { hallo: 'welt' } },
      'https://kaputt.example/api/health': { status: 502, body: {} },
    });
    expect(await pruefeServer('')).toEqual(NICHT_DA);
    expect(await pruefeServer('https://kaputt.example')).toEqual(NICHT_DA);
    expect(await pruefeServer('https://weg.example')).toEqual(NICHT_DA);
  });
});

describe('legeTruheAn', () => {
  it('liefert den Code der neuen Truhe und schickt dabei keine Anmeldung mit', async () => {
    const aufrufe = stelleServer({ '/api/truhen': { status: 201, body: { code: 'k7m2-9xqp-4hrt-w3vn-8dzj' } } });
    expect(await legeTruheAn('')).toBe('k7m2-9xqp-4hrt-w3vn-8dzj');
    expect(aufrufe).toEqual([{ url: '/api/truhen', methode: 'POST', anmeldung: null }]);
  });

  it('gibt die Begründung des Servers weiter, wenn er ablehnt', async () => {
    stelleServer({ '/api/truhen': { status: 403, body: { fehler: 'Auf diesem Server ist die Höchstzahl an Truhen erreicht.' } } });
    await expect(legeTruheAn('')).rejects.toThrow('Höchstzahl an Truhen erreicht');
  });

  it('erklärt, wenn der Server dafür zu alt ist oder nicht antwortet', async () => {
    stelleServer({ '/api/truhen': { status: 404, body: { fehler: 'Nicht gefunden.' } } });
    await expect(legeTruheAn('')).rejects.toThrow(/Server aktualisieren/);
    await expect(legeTruheAn('https://weg.example')).rejects.toThrow(SyncFehler);
  });

  it('nimmt keine Antwort ohne brauchbaren Code an', async () => {
    stelleServer({ '/api/truhen': { status: 201, body: { code: 'kurz' } } });
    await expect(legeTruheAn('')).rejects.toThrow(/kein Truhenblick-Server/);
  });
});

describe('Verbindung zu einer Truhe', () => {
  it('merkt beim Verbinden alles Lokale zum Hochladen vor – so kommt die eigene Truhe in die neue', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    await db.bereiche.update(korb.id, { dirty: 0 });
    await speichereKonfig({ url: '', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' });
    expect((await db.bereiche.get(korb.id))?.dirty).toBe(1);
    expect((await ladeKonfig())?.token).toBe('k7m2-9xqp-4hrt-w3vn-8dzj');
  });

  it('vergisst beim Trennen Code und Hinweis, behält aber die Daten', async () => {
    const korb = await bereichAnlegen('Korb', 'korb');
    await speichereKonfig({ url: '', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' });
    await merkeCodeHinweis(true);
    expect((await db.meta.get(CODE_HINWEIS))?.value).toBe(true);

    await entferneKonfig();
    expect(await ladeKonfig()).toBeNull();
    expect(await db.meta.get(CODE_HINWEIS)).toBeUndefined();
    expect((await db.bereiche.get(korb.id))?.geloeschtAm).toBeNull();
  });
});
