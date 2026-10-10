import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Hono } from 'hono';
import type { UpdateStand } from '../../shared/types.ts';
import { erstelleApp } from '../src/app.ts';
import { oeffneSpeicher, type Speicher } from '../src/speicher.ts';
import { erstelleUpdateDienst, type UpdateOrte } from '../src/update.ts';

const TOKEN = 'ein-ausreichend-langes-test-token';
const ALT = 'a'.repeat(40);
const NEU = 'b'.repeat(40);

let ordner: string;
let orte: UpdateOrte;
let remote: string | null;
let abfragen: number;

function dienst() {
  return erstelleUpdateDienst(orte, async () => {
    abfragen += 1;
    return remote;
  });
}

/** Legt an, was die Einrichtung auf einem echten Server hinterlässt. */
function richteEin(installiert = ALT) {
  mkdirSync(orte.statusVerzeichnis, { recursive: true });
  writeFileSync(orte.konfDatei, '# Kommentar\nTB_PORT=80\nTB_SYNC=1\nTB_REPO=https://git.example/t.git\nTB_BRANCH=main\n');
  writeFileSync(orte.versionDatei, `${installiert}\n`);
}

function schreibeStatus(status: object) {
  writeFileSync(join(orte.statusVerzeichnis, 'status.json'), JSON.stringify(status));
}

beforeEach(() => {
  ordner = mkdtempSync(join(tmpdir(), 'tb-update-'));
  orte = {
    konfDatei: join(ordner, 'install.conf'),
    versionDatei: join(ordner, 'version'),
    statusVerzeichnis: join(ordner, 'status'),
    anfrageDatei: join(ordner, 'update-anfrage'),
  };
  remote = NEU;
  abfragen = 0;
});

afterEach(() => rmSync(ordner, { recursive: true, force: true }));

describe('Update-Dienst', () => {
  it('meldet „nicht möglich“, wo die Einrichtung fehlt (z. B. Docker)', async () => {
    const d = dienst();
    assert.equal((await d.stand(true)).moeglich, false);
    assert.equal(await d.starte(), 'nicht-moeglich');
    assert.equal(existsSync(orte.anfrageDatei), false);
    assert.equal(abfragen, 0);
  });

  it('erkennt eine neue Version', async () => {
    richteEin();
    const stand = await dienst().stand(false);
    assert.deepEqual(
      { moeglich: stand.moeglich, installiert: stand.installiert, verfuegbar: stand.verfuegbar, neu: stand.neu, laeuft: stand.laeuft },
      { moeglich: true, installiert: ALT, verfuegbar: NEU, neu: true, laeuft: false },
    );
    assert.ok(stand.geprueft);
  });

  it('erkennt den aktuellen Stand', async () => {
    richteEin(NEU);
    assert.equal((await dienst().stand(false)).neu, false);
  });

  it('sagt „unbekannt“, wenn die Quelle nicht erreichbar ist', async () => {
    richteEin();
    remote = null;
    const stand = await dienst().stand(true);
    assert.equal(stand.neu, null);
    assert.equal(stand.verfuegbar, null);
  });

  it('fragt die Quelle nicht bei jedem Aufruf ab, auf Wunsch aber sofort', async () => {
    richteEin();
    const d = dienst();
    await d.stand(false);
    await d.stand(false);
    assert.equal(abfragen, 1);
    await d.stand(true);
    assert.equal(abfragen, 2);
  });

  it('stößt das Update über die Anfragedatei an – und nur einmal', async () => {
    richteEin();
    const d = dienst();
    assert.equal(await d.starte(), 'gestartet');
    assert.equal(existsSync(orte.anfrageDatei), true);
    assert.equal((await d.stand(false)).laeuft, true);
    assert.equal(await d.starte(), 'laeuft');
  });

  it('zeigt ein laufendes Update und fragt währenddessen die Quelle nicht ab', async () => {
    richteEin();
    schreibeStatus({ zustand: 'laeuft', gestartet: new Date().toISOString(), beendet: null, meldung: 'Update läuft.' });
    const stand = await dienst().stand(true);
    assert.equal(stand.laeuft, true);
    assert.equal(stand.letztes, null);
    assert.equal(abfragen, 0);
  });

  it('nimmt kein zweites Update an, sobald der Dienst seine Markierung gesetzt hat', async () => {
    richteEin();
    // Der Dienst hat die Anfrage schon entfernt, das Skript aber noch keinen Status geschrieben:
    schreibeStatus({ zustand: 'fertig', gestartet: '2026-10-10T10:00:00Z', beendet: '2026-10-10T10:01:00Z', meldung: 'Update installiert.' });
    writeFileSync(join(orte.statusVerzeichnis, 'laeuft'), '');
    const d = dienst();
    const stand = await d.stand(false);
    assert.equal(stand.laeuft, true);
    assert.equal(stand.letztes, null);
    assert.equal(await d.starte(), 'laeuft');
    assert.equal(existsSync(orte.anfrageDatei), false);
  });

  it('lässt sich von einer uralten Markierung nicht blockieren', async () => {
    richteEin();
    const marke = join(orte.statusVerzeichnis, 'laeuft');
    writeFileSync(marke, '');
    const frueher = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(marke, frueher, frueher);
    assert.equal((await dienst().stand(false)).laeuft, false);
  });

  it('hält ein vor langer Zeit hängengebliebenes Update nicht für laufend', async () => {
    richteEin();
    schreibeStatus({ zustand: 'laeuft', gestartet: '2026-01-01T00:00:00Z', beendet: null, meldung: 'Update läuft.' });
    assert.equal((await dienst().stand(false)).laeuft, false);
  });

  it('berichtet vom Ergebnis – das Protokoll nur nach einem Fehler', async () => {
    richteEin(NEU);
    writeFileSync(join(orte.statusVerzeichnis, 'update.log'), 'Zeile 1\n\u001b[1m==>\u001b[0m Web-App bauen\nnpm error kaputt\n');

    schreibeStatus({ zustand: 'fertig', gestartet: '2026-10-10T10:00:00Z', beendet: '2026-10-10T10:01:00Z', meldung: 'Update installiert.' });
    let stand = await dienst().stand(false);
    assert.deepEqual(stand.letztes, { zustand: 'fertig', beendet: '2026-10-10T10:01:00Z', meldung: 'Update installiert.' });
    assert.equal(stand.protokoll, null);

    schreibeStatus({ zustand: 'fehler', gestartet: '2026-10-10T10:00:00Z', beendet: '2026-10-10T10:01:00Z', meldung: 'Fehlgeschlagen.' });
    stand = await dienst().stand(false);
    assert.equal(stand.letztes?.zustand, 'fehler');
    assert.equal(stand.protokoll, 'Zeile 1\n==> Web-App bauen\nnpm error kaputt');
  });

  it('kommt mit einer unlesbaren Statusdatei zurecht', async () => {
    richteEin();
    writeFileSync(join(orte.statusVerzeichnis, 'status.json'), '{"zustand":"lae');
    const stand = await dienst().stand(false);
    assert.equal(stand.laeuft, false);
    assert.equal(stand.letztes, null);
  });
});

describe('Schnittstelle /api/update', () => {
  let speicher: Speicher;
  let app: Hono;
  const mit = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : undefined);

  beforeEach(() => {
    speicher = oeffneSpeicher(':memory:');
    app = erstelleApp({ speicher, token: TOKEN, melde: () => {}, update: dienst() });
  });
  afterEach(() => speicher.schliessen());

  it('verlangt den Zugangscode', async () => {
    richteEin();
    assert.equal((await app.request('/api/update')).status, 401);
    assert.equal((await app.request('/api/update', { method: 'POST' })).status, 401);
    assert.equal((await app.request('/api/update', { method: 'POST', headers: mit('falsch') })).status, 401);
    assert.equal(existsSync(orte.anfrageDatei), false);
  });

  it('liefert den Stand und stößt das Update an', async () => {
    richteEin();
    const stand = (await (await app.request('/api/update?pruefen=1', { headers: mit(TOKEN) })).json()) as UpdateStand;
    assert.equal(stand.neu, true);

    const start = await app.request('/api/update', { method: 'POST', headers: mit(TOKEN) });
    assert.equal(start.status, 202);
    assert.deepEqual(await start.json(), { gestartet: true, laeuft: true });
    // Der Inhalt der Anfrage trägt keine Befehle – nur einen Zeitstempel.
    assert.match(readFileSync(orte.anfrageDatei, 'utf8'), /^\d{4}-\d\d-\d\dT[\d:.]+Z\n$/);

    const nochmal = await app.request('/api/update', { method: 'POST', headers: mit(TOKEN) });
    assert.deepEqual(await nochmal.json(), { gestartet: false, laeuft: true });
  });

  it('sagt klar, wenn der Server nicht aus der App aktualisiert werden kann', async () => {
    const stand = (await (await app.request('/api/update', { headers: mit(TOKEN) })).json()) as UpdateStand;
    assert.equal(stand.moeglich, false);
    assert.equal((await app.request('/api/update', { method: 'POST', headers: mit(TOKEN) })).status, 409);
  });
});
