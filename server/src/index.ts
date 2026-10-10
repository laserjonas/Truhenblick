import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { erstelleApp } from './app.ts';
import { KonfigFehler, leseKonfig } from './konfig.ts';
import { oeffneSpeicher } from './speicher.ts';
import { erstelleUpdateDienst, STANDARD_ORTE } from './update.ts';

function version(): string {
  try {
    const paket = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return paket.version ?? 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

function start(): void {
  let konfig;
  try {
    konfig = leseKonfig();
  } catch (fehler) {
    if (fehler instanceof KonfigFehler) {
      console.error(`Konfigurationsfehler: ${fehler.message}`);
      process.exit(78);
    }
    throw fehler;
  }

  mkdirSync(konfig.datenVerzeichnis, { recursive: true });
  const datei = join(konfig.datenVerzeichnis, 'truhenblick.sqlite');
  const speicher = oeffneSpeicher(datei);

  // Notausgang, wenn niemand mehr das Passwort kennt:  node server/src/index.ts --anmeldung-aus
  // Das geht auch, während der Server läuft – er liest die Einstellung bei jeder Anfrage neu.
  if (process.argv.includes('--anmeldung-aus')) {
    const war = speicher.einstellung('passwort') !== null;
    speicher.einstellungSetzen('passwort', null);
    speicher.sitzungenBeenden();
    speicher.schliessen();
    console.log(
      war
        ? 'Die Anmeldung ist abgeschaltet. Ein neues Passwort lässt sich in der App festlegen (Einstellungen → Server).'
        : 'Auf diesem Server war keine Anmeldung eingerichtet.',
    );
    return;
  }

  const app = erstelleApp({
    speicher,
    token: konfig.token,
    neueTruhen: konfig.neueTruhen,
    maxTruhen: konfig.maxTruhen,
    corsOrigins: konfig.corsOrigins,
    version: version(),
    update: erstelleUpdateDienst(STANDARD_ORTE(konfig.datenVerzeichnis)),
    startAdresse: konfig.startAdresse,
    startErreichbarkeit: konfig.startErreichbarkeit,
  });

  const server = serve({ fetch: app.fetch, port: konfig.port, hostname: konfig.host }, (info) => {
    const stand = speicher.stand();
    console.log(`Truhenblick-Server ${version()} lauscht auf ${info.address}:${info.port}`);
    console.log(`Datenbank: ${datei} (${stand.truhen} Truhen, ${stand.datensaetze} Datensätze)`);
    console.log(`Neue Truhen anlegen: ${konfig.neueTruhen ? `an (höchstens ${konfig.maxTruhen})` : 'aus'}`);
    const art = speicher.einstellung('erreichbarkeit') ?? 'heimnetz';
    console.log(`Erreichbarkeit: ${art}${art === 'heimnetz' ? '' : ` (${speicher.einstellung('adresse') ?? '?'})`}`);
    console.log(`Anmeldung mit Passwort: ${speicher.einstellung('passwort') ? 'an' : 'aus'}`);
  });

  let beendet = false;
  const beenden = (signal: string) => {
    if (beendet) return;
    beendet = true;
    console.log(`${signal} empfangen – fahre herunter.`);
    server.close(() => {
      speicher.schliessen();
      process.exit(0);
    });
    // Hängende Verbindungen sollen das Beenden nicht aufhalten.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => beenden('SIGTERM'));
  process.on('SIGINT', () => beenden('SIGINT'));
}

start();
