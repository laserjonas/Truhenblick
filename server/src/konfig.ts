import { resolve } from 'node:path';

export interface Konfig {
  port: number;
  host: string;
  datenVerzeichnis: string;
  token: string;
  /** Erlaubte Herkünfte für Browser-Anfragen von einer anderen Adresse; leer = nur gleiche Adresse */
  corsOrigins: string[];
}

export const MIN_TOKEN_LAENGE = 16;

export class KonfigFehler extends Error {}

/** Liest die Einstellungen aus Umgebungsvariablen (siehe .env.example). */
export function leseKonfig(env: NodeJS.ProcessEnv = process.env): Konfig {
  const token = (env.SYNC_TOKEN ?? '').trim();
  if (token.length < MIN_TOKEN_LAENGE) {
    throw new KonfigFehler(
      `SYNC_TOKEN fehlt oder ist zu kurz (mindestens ${MIN_TOKEN_LAENGE} Zeichen). ` +
        'Erzeuge eines z. B. mit:  openssl rand -hex 24',
    );
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new KonfigFehler(`PORT ist keine gültige Portnummer: ${env.PORT}`);
  }
  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    datenVerzeichnis: resolve(env.DATA_DIR?.trim() || './data'),
    token,
    corsOrigins: (env.CORS_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  };
}
