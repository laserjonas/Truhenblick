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
  const app = erstelleApp({
    speicher,
    token: konfig.token,
    neueTruhen: konfig.neueTruhen,
    maxTruhen: konfig.maxTruhen,
    corsOrigins: konfig.corsOrigins,
    version: version(),
    update: erstelleUpdateDienst(STANDARD_ORTE(konfig.datenVerzeichnis)),
  });

  const server = serve({ fetch: app.fetch, port: konfig.port, hostname: konfig.host }, (info) => {
    const stand = speicher.stand();
    console.log(`Truhenblick-Server ${version()} lauscht auf ${info.address}:${info.port}`);
    console.log(`Datenbank: ${datei} (${stand.truhen} Truhen, ${stand.datensaetze} Datensätze)`);
    console.log(`Neue Truhen anlegen: ${konfig.neueTruhen ? `an (höchstens ${konfig.maxTruhen})` : 'aus'}`);
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
