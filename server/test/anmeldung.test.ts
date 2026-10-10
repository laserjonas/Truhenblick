import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ServerAuskunft, ServerEinstellungen } from '../../shared/types.ts';
import { clientAdresse, istPrivat, leseRechnername } from '../src/adresse.ts';
import { erstelleApp, type AppOptionen } from '../src/app.ts';
import { KonfigFehler, leseKonfig } from '../src/konfig.ts';
import { passwortHash, passwortStimmt } from '../src/passwort.ts';
import { oeffneSpeicher, type Speicher } from '../src/speicher.ts';

const CODE = 'ein-ausreichend-langes-test-token';
const PASSWORT = 'erbsen-und-moehren';
const LEER = { seit: 0, bereiche: [], artikel: [] };
const TAG = 24 * 60 * 60 * 1000;

let speicher: Speicher;
let app: ReturnType<typeof erstelleApp>;
let uhr: number;

function starte(optionen: Partial<AppOptionen> = {}) {
  app = erstelleApp({ speicher, token: CODE, melde: () => {}, jetzt: () => uhr, ...optionen });
}

interface Kopf {
  code?: string | null;
  sitzung?: string | null;
  von?: string;
}

function rufe(pfad: string, { code = CODE, sitzung = null, von }: Kopf = {}, koerper?: unknown, methode?: string) {
  return app.request(pfad, {
    method: methode ?? (koerper === undefined ? 'GET' : 'POST'),
    headers: {
      ...(code ? { Authorization: `Bearer ${code}` } : {}),
      ...(sitzung ? { 'X-Truhenblick-Sitzung': sitzung } : {}),
      ...(von ? { 'X-Forwarded-For': von } : {}),
      ...(koerper === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: koerper === undefined ? undefined : typeof koerper === 'string' ? koerper : JSON.stringify(koerper),
  });
}

async function json<T>(antwort: Response | Promise<Response>): Promise<T> {
  return (await (await antwort).json()) as T;
}

/** Legt das Passwort fest und liefert die Anmeldung des Geräts, das es getan hat. */
async function schuetze(passwort = PASSWORT): Promise<string> {
  const antwort = await rufe('/api/passwort', {}, { passwort });
  assert.equal(antwort.status, 200);
  return (await json<{ sitzung: string }>(antwort)).sitzung;
}

async function meldeAn(passwort = PASSWORT, von?: string): Promise<Response> {
  return rufe('/api/anmelden', { code: null, von }, { passwort });
}

beforeEach(() => {
  uhr = Date.UTC(2026, 9, 10, 12);
  speicher = oeffneSpeicher(':memory:');
  starte();
});

afterEach(() => speicher.schliessen());

describe('Adresse des Geräts', () => {
  it('erkennt private Netze', () => {
    for (const ip of ['10.1.2.3', '172.18.0.1', '192.168.178.20', '127.0.0.1', '100.100.1.1', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.5']) {
      assert.equal(istPrivat(ip), true, ip);
    }
    for (const ip of ['203.0.113.7', '172.32.0.1', '8.8.8.8', '2a02:8070::1', 'quatsch']) assert.equal(istPrivat(ip), false, ip);
  });

  it('nimmt ohne Proxy nur den Eintrag des eigenen Webservers ernst', () => {
    assert.equal(clientAdresse('203.0.113.7', undefined, false), '203.0.113.7');
    // Alles links davon kann der Absender erfunden haben.
    assert.equal(clientAdresse('1.2.3.4, 203.0.113.7', undefined, false), '203.0.113.7');
    assert.equal(clientAdresse(undefined, '::ffff:192.168.1.9', false), '192.168.1.9');
    assert.equal(clientAdresse(undefined, undefined, false), 'unbekannt');
  });

  it('findet hinter einem Proxy das Gerät – nicht den Proxy und nichts Erfundenes', () => {
    // Gerät im Internet → Proxy im Heimnetz → Webserver
    assert.equal(clientAdresse('203.0.113.7, 192.168.178.5', undefined, true), '203.0.113.7');
    assert.equal(clientAdresse('8.8.8.8, 203.0.113.7, 192.168.178.5', undefined, true), '203.0.113.7');
    assert.equal(clientAdresse('10.0.0.99, 203.0.113.7, 172.18.0.3', undefined, true), '203.0.113.7');
    // Gerät im Heimnetz über den Proxy: der Eintrag vor dem Proxy
    assert.equal(clientAdresse('192.168.178.20, 192.168.178.5', undefined, true), '192.168.178.20');
    // Gerät im Heimnetz direkt am Webserver
    assert.equal(clientAdresse('192.168.178.20', undefined, true), '192.168.178.20');
    // Unsinn in der Liste zählt nicht.
    assert.equal(clientAdresse('<script>, 203.0.113.7, 192.168.178.5', undefined, true), '203.0.113.7');
  });

  it('liest Rechnernamen aus dem, was Menschen eintippen', () => {
    assert.equal(leseRechnername('truhe.example.de'), 'truhe.example.de');
    assert.equal(leseRechnername(' https://Truhe.Example.DE/ '), 'truhe.example.de');
    assert.equal(leseRechnername('http://truhe.example.de/#/einstellungen'), 'truhe.example.de');
    assert.equal(leseRechnername('truhe.fritz.box.'), 'truhe.fritz.box');
    for (const falsch of ['', 'truhe', '192.168.178.123', 'truhe.example.de:8443', 'tru he.de', '-truhe.de', 'truhe..de', ':80', 'a'.repeat(64) + '.de']) {
      assert.equal(leseRechnername(falsch), null, falsch);
    }
  });
});

describe('Passwort', () => {
  it('wird nur als Prüfsumme gespeichert und stimmt nur für die richtige Eingabe', async () => {
    const hash = await passwortHash(PASSWORT);
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(hash.includes(PASSWORT), false);
    assert.notEqual(await passwortHash(PASSWORT), hash, 'jedes Mal ein anderes Salz');
    assert.equal(await passwortStimmt(PASSWORT, hash), true);
    assert.equal(await passwortStimmt('erbsen-und-moehre', hash), false);
    assert.equal(await passwortStimmt(PASSWORT, 'kaputt'), false);
  });
});

describe('Anmeldung mit Passwort', () => {
  it('ist ohne Passwort abgeschaltet – alles geht wie bisher', async () => {
    const auskunft = await json<ServerAuskunft>(rufe('/api/health', { code: null }));
    assert.equal(auskunft.anmeldung, false);
    assert.equal(auskunft.angemeldet, true);
    assert.equal((await rufe('/api/sync', {}, LEER)).status, 200);
    assert.equal((await meldeAn()).status, 409);
  });

  it('lässt nach dem Festlegen nur noch Angemeldete an die Daten', async () => {
    const sitzung = await schuetze();
    const ab = await rufe('/api/sync', {}, LEER);
    assert.equal(ab.status, 401);
    assert.deepEqual(await ab.json(), { fehler: 'Bitte melde dich an.', art: 'anmeldung' });
    assert.equal((await rufe('/api/sync', { sitzung: 'sitz-erfunden' }, LEER)).status, 401);
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 200);
    // Auch der richtige Code der Truhe hilft ohne Anmeldung nicht – und es entsteht keine neue Truhe.
    assert.equal((await rufe('/api/code', {}, {})).status, 401);
    assert.equal((await rufe('/api/truhen', { code: null }, {})).status, 401);
    assert.equal(speicher.anzahlTruhen(), 1);
  });

  it('zeigt Unangemeldeten nur, dass eine Anmeldung nötig ist', async () => {
    const sitzung = await schuetze();
    const fremd = await json<ServerAuskunft>(rufe('/api/health', { code: null }));
    assert.equal(fremd.anmeldung, true);
    assert.equal(fremd.angemeldet, false);
    assert.equal((await json<ServerAuskunft>(rufe('/api/health', { code: null, sitzung }))).angemeldet, true);
  });

  it('meldet mit dem richtigen Passwort an – jedes Gerät bekommt eine eigene Kennung', async () => {
    await schuetze();
    assert.equal((await meldeAn('falsches-passwort')).status, 401);
    assert.equal((await rufe('/api/anmelden', { code: null }, {})).status, 400);
    assert.equal((await rufe('/api/anmelden', { code: null }, 'kein json')).status, 400);
    const a = (await json<{ sitzung: string }>(meldeAn())).sitzung;
    const b = (await json<{ sitzung: string }>(meldeAn())).sitzung;
    assert.match(a, /^sitz-[\w-]{43}$/);
    assert.notEqual(a, b);
    assert.equal((await rufe('/api/sync', { sitzung: a }, LEER)).status, 200);
    assert.equal((await rufe('/api/sync', { sitzung: b }, LEER)).status, 200);
  });

  it('meldet ein Gerät ab, ohne die anderen zu stören', async () => {
    const erste = await schuetze();
    const zweite = (await json<{ sitzung: string }>(meldeAn())).sitzung;
    assert.equal((await rufe('/api/abmelden', { code: null, sitzung: zweite }, {})).status, 200);
    assert.equal((await rufe('/api/sync', { sitzung: zweite }, LEER)).status, 401);
    assert.equal((await rufe('/api/sync', { sitzung: erste }, LEER)).status, 200);
  });

  it('vergisst Anmeldungen, die 90 Tage nicht benutzt wurden', async () => {
    const sitzung = await schuetze();
    uhr += 89 * TAG;
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 200);
    // Die Benutzung zählt: Ab jetzt laufen wieder 90 Tage.
    uhr += 89 * TAG;
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 200);
    uhr += 91 * TAG;
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 401);
    assert.equal(speicher.anzahlSitzungen(), 0);
  });

  it('gilt nach einem Neustart des Servers weiter', async () => {
    const sitzung = await schuetze();
    starte();
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 200);
    assert.equal((await meldeAn()).status, 200);
  });

  it('sperrt eine Adresse nach zehn falschen Passwörtern – andere bleiben unberührt', async () => {
    await schuetze();
    for (let i = 0; i < 10; i++) assert.equal((await meldeAn('falsch-' + i, '203.0.113.7')).status, 401);
    assert.equal((await meldeAn(PASSWORT, '203.0.113.7')).status, 429);
    assert.equal((await meldeAn(PASSWORT, '198.51.100.1')).status, 200);
    uhr += 11 * 60 * 1000;
    assert.equal((await meldeAn(PASSWORT, '203.0.113.7')).status, 200);
  });

  it('bremst auch, wer bei jedem Versuch eine andere Adresse vorgibt – Angemeldete merken nichts', async () => {
    const sitzung = await schuetze();
    for (let i = 0; i < 30; i++) assert.equal((await meldeAn('falsch', `203.0.113.${i}`)).status, 401);
    assert.equal((await meldeAn(PASSWORT, '198.51.100.1')).status, 429);
    assert.equal((await rufe('/api/sync', { sitzung }, LEER)).status, 200);
    uhr += 11 * 60 * 1000;
    assert.equal((await meldeAn(PASSWORT, '198.51.100.1')).status, 200);
  });

  it('lässt die Übersicht für Home Assistant mit dem Lese-Schlüssel offen', async () => {
    const schluessel = (await json<{ schluessel: string }>(rufe('/api/lesezugang', {}, {}))).schluessel;
    await schuetze();
    assert.equal((await rufe('/api/uebersicht', { code: schluessel })).status, 200);
    assert.equal((await rufe('/api/uebersicht', { code: 'lese-falsch' })).status, 401);
    // Verwalten lässt sich der Schlüssel nur angemeldet.
    assert.equal((await rufe('/api/lesezugang', {})).status, 401);
  });
});

describe('Passwort festlegen und ändern', () => {
  it('darf nur die zuerst angelegte Truhe', async () => {
    const andere = (await json<{ code: string }>(rufe('/api/truhen', { code: null }, {}))).code;
    const antwort = await rufe('/api/passwort', { code: andere }, { passwort: PASSWORT });
    assert.equal(antwort.status, 403);
    assert.equal((await rufe('/api/passwort', { code: null }, { passwort: PASSWORT })).status, 401);
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).anmeldung, false);
  });

  it('verlangt mindestens acht Zeichen', async () => {
    for (const zuSchwach of ['', 'kurz', '1234567', 12345678, undefined]) {
      assert.equal((await rufe('/api/passwort', {}, { passwort: zuSchwach })).status, 400, String(zuSchwach));
    }
    assert.equal((await rufe('/api/passwort', {}, { passwort: 'x'.repeat(201) })).status, 400);
    assert.equal((await rufe('/api/passwort', {}, { passwort: '12345678' })).status, 200);
  });

  it('meldet beim Ändern alle anderen Geräte ab – das ändernde bleibt angemeldet', async () => {
    const admin = await schuetze();
    const handy = (await json<{ sitzung: string }>(meldeAn())).sitzung;
    const antwort = await rufe('/api/passwort', { sitzung: admin }, { passwort: 'ein-ganz-neues-passwort' });
    assert.equal(antwort.status, 200);
    const neu = (await json<{ sitzung: string }>(antwort)).sitzung;
    assert.equal((await rufe('/api/sync', { sitzung: handy }, LEER)).status, 401);
    assert.equal((await rufe('/api/sync', { sitzung: admin }, LEER)).status, 401);
    assert.equal((await rufe('/api/sync', { sitzung: neu }, LEER)).status, 200);
    assert.equal((await meldeAn(PASSWORT)).status, 401);
    assert.equal((await meldeAn('ein-ganz-neues-passwort')).status, 200);
  });

  it('lässt sich nur angemeldet ändern oder abschalten', async () => {
    const admin = await schuetze();
    assert.equal((await rufe('/api/passwort', {}, { passwort: null })).status, 401);
    assert.equal((await rufe('/api/passwort', { sitzung: admin }, { passwort: null })).status, 200);
    assert.equal((await json<ServerAuskunft>(rufe('/api/health', { code: null }))).anmeldung, false);
    assert.equal((await rufe('/api/sync', {}, LEER)).status, 200);
    assert.equal(speicher.anzahlSitzungen(), 0);
  });

  it('meldet auf Wunsch alle anderen Geräte ab', async () => {
    const admin = await schuetze();
    const handy = (await json<{ sitzung: string }>(meldeAn())).sitzung;
    assert.equal((await json<ServerEinstellungen>(rufe('/api/server', { sitzung: admin }))).sitzungen, 2);
    assert.equal((await rufe('/api/sitzungen', { sitzung: admin }, undefined, 'DELETE')).status, 200);
    assert.equal((await rufe('/api/sync', { sitzung: handy }, LEER)).status, 401);
    assert.equal((await rufe('/api/sync', { sitzung: admin }, LEER)).status, 200);
  });

  it('lässt sich von der Serverseite abschalten, wenn niemand mehr das Passwort kennt', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'truhenblick-test-'));
    try {
      const datei = oeffneSpeicher(join(ordner, 'truhenblick.sqlite'));
      datei.einstellungSetzen('passwort', await passwortHash(PASSWORT));
      datei.sitzungAnlegen('abc', uhr, 0);
      datei.schliessen();
      const aufruf = () =>
        execFileSync(process.execPath, [join(import.meta.dirname, '../src/index.ts'), '--anmeldung-aus'], {
          env: { ...process.env, DATA_DIR: ordner, SYNC_TOKEN: '' },
          encoding: 'utf8',
        });
      assert.match(aufruf(), /Die Anmeldung ist abgeschaltet/);
      assert.match(aufruf(), /war keine Anmeldung eingerichtet/);
      const danach = oeffneSpeicher(join(ordner, 'truhenblick.sqlite'));
      assert.equal(danach.einstellung('passwort'), null);
      assert.equal(danach.anzahlSitzungen(), 0);
      danach.schliessen();
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });
});

describe('Adresse und Erreichbarkeit', () => {
  const stelleEin = (koerper: unknown, kopf: Kopf = {}) => rufe('/api/server', kopf, koerper);

  it('steht anfangs auf „nur im Heimnetz“', async () => {
    const e = await json<ServerEinstellungen>(rufe('/api/server'));
    assert.deepEqual(
      { betreiber: e.betreiber, erreichbarkeit: e.erreichbarkeit, adresse: e.adresse, anmeldung: e.anmeldung },
      { betreiber: true, erreichbarkeit: 'heimnetz', adresse: '', anmeldung: false },
    );
  });

  it('nimmt die Adresse so an, wie Menschen sie eintippen', async () => {
    const antwort = await stelleEin({ erreichbarkeit: 'proxy', adresse: 'https://Truhe.Example.de/' });
    assert.equal(antwort.status, 200);
    assert.equal((await json<ServerEinstellungen>(antwort)).adresse, 'truhe.example.de');
    const auskunft = await json<ServerAuskunft>(rufe('/api/health', { code: null }));
    assert.equal(auskunft.erreichbarkeit, 'proxy');
    assert.equal(auskunft.adresse, 'truhe.example.de');
  });

  it('lehnt Unbrauchbares ab und lässt dann alles beim Alten', async () => {
    for (const koerper of [{ erreichbarkeit: 'proxy', adresse: '192.168.178.123' }, { erreichbarkeit: 'selbst', adresse: '' }, { erreichbarkeit: 'selbst' }, { erreichbarkeit: 'quer', adresse: 'a.de' }, 'kein json']) {
      assert.equal((await stelleEin(koerper)).status, 400, JSON.stringify(koerper));
    }
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).erreichbarkeit, 'heimnetz');
  });

  it('merkt sich die Adresse, wenn man zurück auf „Heimnetz“ stellt', async () => {
    await stelleEin({ erreichbarkeit: 'selbst', adresse: 'truhe.example.de' });
    assert.equal((await stelleEin({ erreichbarkeit: 'heimnetz' })).status, 200);
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).adresse, null);
    assert.equal((await json<ServerEinstellungen>(rufe('/api/server'))).adresse, 'truhe.example.de');
  });

  it('darf nur die zuerst angelegte Truhe ändern – andere sehen die Adresse nicht', async () => {
    await stelleEin({ erreichbarkeit: 'proxy', adresse: 'truhe.example.de' });
    const andere = (await json<{ code: string }>(rufe('/api/truhen', { code: null }, {}))).code;
    assert.equal((await stelleEin({ erreichbarkeit: 'heimnetz' }, { code: andere })).status, 403);
    const sicht = await json<ServerEinstellungen>(rufe('/api/server', { code: andere }));
    assert.deepEqual({ betreiber: sicht.betreiber, adresse: sicht.adresse }, { betreiber: false, adresse: '' });
    assert.equal((await rufe('/api/server', { code: null })).status, 401);
  });

  it('zeigt, wie die Anfrage beim Server ankam', async () => {
    const direkt = await json<ServerEinstellungen>(
      app.request('/api/server', { headers: { Authorization: `Bearer ${CODE}`, Host: '192.168.178.123', 'X-Forwarded-For': '192.168.178.20', 'X-Forwarded-Proto': 'http' } }),
    );
    assert.deepEqual(direkt.anfrage, { host: '192.168.178.123', https: false, ueberProxy: false });
    const proxy = await json<ServerEinstellungen>(
      app.request('/api/server', {
        headers: { Authorization: `Bearer ${CODE}`, Host: 'truhe.example.de', 'X-Forwarded-For': '203.0.113.7, 192.168.178.5', 'X-Forwarded-Proto': 'https' },
      }),
    );
    assert.deepEqual(proxy.anfrage, { host: 'truhe.example.de', https: true, ueberProxy: true });
  });

  it('übernimmt Startwerte aus der Konfiguration nur, solange in der App nichts eingestellt wurde', async () => {
    starte({ startAdresse: 'alt.example.de', startErreichbarkeit: 'selbst' });
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).adresse, 'alt.example.de');
    await stelleEin({ erreichbarkeit: 'heimnetz' });
    starte({ startAdresse: 'alt.example.de', startErreichbarkeit: 'selbst' });
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).erreichbarkeit, 'heimnetz');
  });

  it('ignoriert Startwerte, die keine Adresse sind (z. B. „:80“ aus einer alten .env)', async () => {
    starte({ startAdresse: ':80', startErreichbarkeit: 'selbst' });
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).erreichbarkeit, 'heimnetz');
  });

  it('liest die Startwerte aus der Umgebung', () => {
    const k = leseKonfig({ START_ADRESSE: ' truhe.example.de ', START_ERREICHBARKEIT: 'Proxy' });
    assert.deepEqual([k.startAdresse, k.startErreichbarkeit], ['truhe.example.de', 'proxy']);
    assert.deepEqual([leseKonfig({}).startAdresse, leseKonfig({}).startErreichbarkeit], [undefined, undefined]);
    assert.throws(() => leseKonfig({ START_ERREICHBARKEIT: 'internet' }), KonfigFehler);
  });

  it('behält die Kennung des Servers über Neustarts', async () => {
    const vorher = (await json<ServerAuskunft>(rufe('/api/health'))).kennung;
    starte();
    assert.equal((await json<ServerAuskunft>(rufe('/api/health'))).kennung, vorher);
  });
});

describe('Sperren hinter einem Reverse Proxy', () => {
  const PROXY = '192.168.178.5';

  it('rechnen ohne Einstellung alles dem Proxy zu', async () => {
    for (let i = 0; i < 10; i++) await rufe('/api/sync', { code: 'falsch', von: `203.0.113.7, ${PROXY}` }, LEER);
    assert.equal((await rufe('/api/sync', { von: `198.51.100.1, ${PROXY}` }, LEER)).status, 429);
  });

  it('treffen mit der Einstellung „Reverse Proxy“ nur das Gerät, das sich vertan hat', async () => {
    await rufe('/api/server', {}, { erreichbarkeit: 'proxy', adresse: 'truhe.example.de' });
    for (let i = 0; i < 10; i++) await rufe('/api/sync', { code: 'falsch', von: `203.0.113.7, ${PROXY}` }, LEER);
    assert.equal((await rufe('/api/sync', { von: `203.0.113.7, ${PROXY}` }, LEER)).status, 429);
    assert.equal((await rufe('/api/sync', { von: `198.51.100.1, ${PROXY}` }, LEER)).status, 200);
    // Eine vorangestellte erfundene Adresse hilft dem Gesperrten nicht.
    assert.equal((await rufe('/api/sync', { von: `8.8.8.8, 203.0.113.7, ${PROXY}` }, LEER)).status, 429);
  });
});

describe('Rückfrage des Webservers vor einem Zertifikat', () => {
  const frage = (name: string, kopf: Record<string, string> = {}) => app.request(`/api/zertifikat?domain=${name}`, { headers: kopf });

  it('erlaubt nur die eingestellte Adresse – und nur bei „Zertifikat selbst holen“', async () => {
    assert.equal((await frage('truhe.example.de')).status, 403);
    await rufe('/api/server', {}, { erreichbarkeit: 'proxy', adresse: 'truhe.example.de' });
    assert.equal((await frage('truhe.example.de')).status, 403);
    await rufe('/api/server', {}, { erreichbarkeit: 'selbst', adresse: 'truhe.example.de' });
    assert.equal((await frage('truhe.example.de')).status, 200);
    assert.equal((await frage('Truhe.Example.de')).status, 200);
    assert.equal((await frage('boese.example.com')).status, 403);
    assert.equal((await frage('')).status, 403);
  });

  it('antwortet nur dem eigenen Webserver, nicht nach außen', async () => {
    await rufe('/api/server', {}, { erreichbarkeit: 'selbst', adresse: 'truhe.example.de' });
    assert.equal((await frage('truhe.example.de', { 'X-Forwarded-For': '203.0.113.7' })).status, 404);
  });

  it('bleibt auch mit Anmeldung erreichbar – sonst bekäme der Server kein Zertifikat', async () => {
    await rufe('/api/server', {}, { erreichbarkeit: 'selbst', adresse: 'truhe.example.de' });
    await schuetze();
    assert.equal((await frage('truhe.example.de')).status, 200);
  });
});
