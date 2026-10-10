import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db.ts';
import { httpsZiel } from './anmeldung.ts';
import {
  holeServerEinstellungen,
  horcheAufFehlendeAnmeldung,
  leseServerInfo,
  meldeAb,
  meldeAn,
  NICHT_DA,
  pruefeAdresse,
  pruefeServer,
  setzePasswort,
  speichereKonfig,
  SyncFehler,
  synchronisiere,
  type ServerInfo,
} from './client.ts';

type Antwort = { status: number; body: unknown } | 'netzfehler';

interface Aufruf {
  url: string;
  methode: string;
  sitzung: string | null;
  koerper: unknown;
}

/** Ersetzt fetch durch feste Antworten (je „METHODE Adresse“) und merkt sich die Aufrufe. */
function stelleServer(antworten: Record<string, Antwort>) {
  const aufrufe: Aufruf[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const kopf = new Headers(init.headers);
    const methode = init.method ?? 'GET';
    aufrufe.push({ url, methode, sitzung: kopf.get('X-Truhenblick-Sitzung'), koerper: init.body ? JSON.parse(String(init.body)) : undefined });
    const antwort = antworten[`${methode} ${url}`];
    if (!antwort || antwort === 'netzfehler') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(antwort.body), { status: antwort.status, headers: { 'Content-Type': 'application/json' } });
  });
  return aufrufe;
}

const AUSKUNFT = { ok: true, app: 'truhenblick', version: '0.5.0', neueTruhen: true, erreichbarkeit: 'heimnetz', adresse: null, kennung: 'abc123' };
const SITZUNG = 'sitz-' + 'x'.repeat(43);
const ABSAGE: Antwort = { status: 401, body: { fehler: 'Bitte melde dich an.', art: 'anmeldung' } };

beforeEach(async () => {
  await Promise.all([db.bereiche.clear(), db.artikel.clear(), db.meta.clear()]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  horcheAufFehlendeAnmeldung(null);
});

describe('Auskunft des Servers', () => {
  it('liest, ob ein Passwort verlangt wird und ob dieses Gerät angemeldet ist', () => {
    expect(leseServerInfo({ ...AUSKUNFT, anmeldung: true, angemeldet: false })).toMatchObject({ da: true, anmeldung: true, angemeldet: false });
    expect(leseServerInfo({ ...AUSKUNFT, anmeldung: true, angemeldet: true })).toMatchObject({ anmeldung: true, angemeldet: true });
    expect(leseServerInfo({ ...AUSKUNFT, anmeldung: false, angemeldet: true, erreichbarkeit: 'proxy', adresse: 'truhe.example.de' })).toEqual({
      da: true,
      neueTruhen: true,
      anmeldung: false,
      angemeldet: true,
      erreichbarkeit: 'proxy',
      adresse: 'truhe.example.de',
      kennung: 'abc123',
    } satisfies ServerInfo);
  });

  it('hält einen älteren Server ohne diese Angaben für offen', () => {
    expect(leseServerInfo({ ok: true, app: 'truhenblick', version: '0.4.0', neueTruhen: true })).toMatchObject({
      da: true,
      anmeldung: false,
      angemeldet: true,
      erreichbarkeit: 'heimnetz',
      adresse: null,
    });
  });

  it('erkennt fremde Antworten', () => {
    for (const fremd of [null, 'hallo', [], { app: 'etwas anderes' }]) expect(leseServerInfo(fremd)).toEqual(NICHT_DA);
  });
});

describe('Anmelden', () => {
  it('merkt sich die Anmeldung und schickt sie danach bei jeder Anfrage mit', async () => {
    const aufrufe = stelleServer({
      'POST /api/anmelden': { status: 200, body: { sitzung: SITZUNG } },
      'GET /api/health': { status: 200, body: { ...AUSKUNFT, anmeldung: true, angemeldet: true } },
    });
    await meldeAn('erbsen-und-moehren');
    expect(aufrufe[0]).toEqual({ url: '/api/anmelden', methode: 'POST', sitzung: null, koerper: { passwort: 'erbsen-und-moehren' } });
    expect((await pruefeServer('')).angemeldet).toBe(true);
    expect(aufrufe[1]?.sitzung).toBe(SITZUNG);
  });

  it('meldet ein falsches Passwort verständlich – und merkt sich nichts', async () => {
    const aufrufe = stelleServer({
      'POST /api/anmelden': { status: 401, body: { fehler: 'Das Passwort stimmt nicht.' } },
      'GET /api/health': { status: 200, body: { ...AUSKUNFT, anmeldung: true, angemeldet: false } },
    });
    await expect(meldeAn('falsch')).rejects.toThrow('Das Passwort stimmt nicht.');
    await pruefeServer('');
    expect(aufrufe[1]?.sitzung).toBeNull();
  });

  it('gibt die Sperre nach zu vielen Versuchen weiter', async () => {
    stelleServer({ 'POST /api/anmelden': { status: 429, body: { fehler: 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.' } } });
    await expect(meldeAn('egal')).rejects.toMatchObject({ art: 'gesperrt', message: expect.stringContaining('Zu viele Fehlversuche') });
  });

  it('schickt die Anmeldung nur an den Server, bei dem sie entstanden ist', async () => {
    const aufrufe = stelleServer({
      'POST /api/anmelden': { status: 200, body: { sitzung: SITZUNG } },
      'GET https://fremd.example/api/health': { status: 200, body: AUSKUNFT },
    });
    await meldeAn('erbsen-und-moehren');
    await pruefeServer('https://fremd.example');
    expect(aufrufe[1]?.sitzung).toBeNull();
  });

  it('meldet sich beim verbundenen Server an, nicht bei dem, von dem die App kommt', async () => {
    await speichereKonfig({ url: 'https://truhe.example.de', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' });
    const aufrufe = stelleServer({ 'POST https://truhe.example.de/api/anmelden': { status: 200, body: { sitzung: SITZUNG } } });
    await meldeAn('erbsen-und-moehren');
    expect(aufrufe.map((a) => a.url)).toEqual(['https://truhe.example.de/api/anmelden']);
  });

  it('vergisst die Anmeldung beim Abmelden – auch wenn der Server gerade nicht antwortet', async () => {
    const aufrufe = stelleServer({
      'POST /api/anmelden': { status: 200, body: { sitzung: SITZUNG } },
      'POST /api/abmelden': 'netzfehler',
      'GET /api/health': { status: 200, body: { ...AUSKUNFT, anmeldung: true, angemeldet: false } },
    });
    await meldeAn('erbsen-und-moehren');
    await meldeAb();
    expect(aufrufe[1]).toMatchObject({ url: '/api/abmelden', sitzung: SITZUNG });
    await pruefeServer('');
    expect(aufrufe[2]?.sitzung).toBeNull();
  });
});

describe('Fehlende Anmeldung', () => {
  it('unterscheidet sie vom falschen Code der Truhe und meldet sie weiter', async () => {
    await speichereKonfig({ url: '', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' });
    const gemeldet = vi.fn();
    horcheAufFehlendeAnmeldung(gemeldet);

    stelleServer({ 'POST /api/sync': ABSAGE });
    await expect(synchronisiere()).rejects.toMatchObject({ art: 'anmeldung' });
    expect(gemeldet).toHaveBeenCalledTimes(1);

    stelleServer({ 'POST /api/sync': { status: 401, body: { fehler: 'Zugangscode fehlt oder ist falsch.' } } });
    await expect(synchronisiere()).rejects.toMatchObject({ art: 'token', message: 'Der Zugangscode stimmt nicht.' });
    expect(gemeldet).toHaveBeenCalledTimes(1);
  });

  it('ist ein SyncFehler – der Abgleich versucht es später erneut, die Daten bleiben vorgemerkt', async () => {
    await speichereKonfig({ url: '', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' });
    stelleServer({ 'POST /api/sync': ABSAGE });
    await expect(synchronisiere()).rejects.toBeInstanceOf(SyncFehler);
  });
});

describe('Einstellungen des Servers', () => {
  const EINSTELLUNGEN = {
    betreiber: true,
    erreichbarkeit: 'proxy',
    adresse: 'truhe.example.de',
    anmeldung: true,
    sitzungen: 2,
    anfrage: { host: 'truhe.example.de', https: true, ueberProxy: true },
  };

  beforeEach(() => speichereKonfig({ url: '', token: 'k7m2-9xqp-4hrt-w3vn-8dzj' }));

  it('liest sie und füllt Fehlendes vorsichtig auf', async () => {
    stelleServer({ 'GET /api/server': { status: 200, body: EINSTELLUNGEN } });
    expect(await holeServerEinstellungen()).toEqual(EINSTELLUNGEN);

    stelleServer({ 'GET /api/server': { status: 200, body: { betreiber: false, anfrage: {} } } });
    expect(await holeServerEinstellungen()).toEqual({
      betreiber: false,
      erreichbarkeit: 'heimnetz',
      adresse: '',
      anmeldung: false,
      sitzungen: 0,
      anfrage: { host: '', https: false, ueberProxy: false },
    });
  });

  it('erklärt, wenn der Server sie noch nicht kennt', async () => {
    stelleServer({ 'GET /api/server': { status: 404, body: { fehler: 'Nicht gefunden.' } } });
    await expect(holeServerEinstellungen()).rejects.toThrow('Bitte zuerst den Server aktualisieren');
  });

  it('bleibt nach dem Festlegen des Passworts auf diesem Gerät angemeldet', async () => {
    const aufrufe = stelleServer({
      'POST /api/passwort': { status: 200, body: { anmeldung: true, sitzung: SITZUNG } },
      'GET /api/server': { status: 200, body: EINSTELLUNGEN },
    });
    await setzePasswort('erbsen-und-moehren');
    expect(aufrufe[0]?.koerper).toEqual({ passwort: 'erbsen-und-moehren' });
    await holeServerEinstellungen();
    expect(aufrufe[1]?.sitzung).toBe(SITZUNG);
  });

  it('vergisst die Anmeldung, wenn sie abgeschaltet wird', async () => {
    const aufrufe = stelleServer({
      'POST /api/passwort': { status: 200, body: { anmeldung: true, sitzung: SITZUNG } },
      'GET /api/server': { status: 200, body: EINSTELLUNGEN },
    });
    await setzePasswort('erbsen-und-moehren');
    stelleServer({ 'POST /api/passwort': { status: 200, body: { anmeldung: false } }, 'GET /api/server': { status: 200, body: EINSTELLUNGEN } });
    await setzePasswort(null);
    aufrufe.length = 0;
    const danach = stelleServer({ 'GET /api/server': { status: 200, body: EINSTELLUNGEN } });
    await holeServerEinstellungen();
    expect(danach[0]?.sitzung).toBeNull();
  });
});

describe('Adresse prüfen', () => {
  it('erkennt denselben Server an seiner Kennung', async () => {
    stelleServer({ 'GET https://truhe.example.de/api/health': { status: 200, body: AUSKUNFT } });
    expect(await pruefeAdresse('truhe.example.de', 'abc123')).toBe('ok');
    expect(await pruefeAdresse('truhe.example.de', 'andere')).toBe('anderer-server');
    expect(await pruefeAdresse('truhe.example.de', null)).toBe('anderer-server');
  });

  it('unterscheidet „antwortet etwas anderes“ von „nicht erreichbar“', async () => {
    stelleServer({
      'GET https://fremd.example/api/health': { status: 200, body: { hallo: 'welt' } },
      'GET https://kaputt.example/api/health': { status: 502, body: {} },
    });
    expect(await pruefeAdresse('fremd.example', 'abc123')).toBe('anderer-server');
    expect(await pruefeAdresse('kaputt.example', 'abc123')).toBe('nicht-erreichbar');
    expect(await pruefeAdresse('weg.example', 'abc123')).toBe('nicht-erreichbar');
  });
});

describe('Wechsel auf https', () => {
  const selbst: ServerInfo = { ...NICHT_DA, da: true, erreichbarkeit: 'selbst', adresse: 'truhe.example.de' };
  const ort = (protocol: string, hostname: string) => ({ protocol, hostname, pathname: '/', search: '', hash: '#/liste' });

  it('geschieht nur unter der eingestellten Adresse und nur, wenn Truhenblick das Zertifikat selbst holt', () => {
    expect(httpsZiel(selbst, ort('http:', 'truhe.example.de'))).toBe('https://truhe.example.de/#/liste');
    expect(httpsZiel(selbst, ort('http:', 'Truhe.Example.de'))).toBe('https://truhe.example.de/#/liste');
    // Über die IP bleibt die App erreichbar – sonst käme man bei einem Zertifikatsproblem nicht mehr heran.
    expect(httpsZiel(selbst, ort('http:', '192.168.178.123'))).toBeNull();
    expect(httpsZiel(selbst, ort('https:', 'truhe.example.de'))).toBeNull();
    // Hinter einem Proxy entscheidet der über die Umleitung.
    expect(httpsZiel({ ...selbst, erreichbarkeit: 'proxy' }, ort('http:', 'truhe.example.de'))).toBeNull();
    expect(httpsZiel({ ...selbst, adresse: null }, ort('http:', 'truhe.example.de'))).toBeNull();
  });
});
