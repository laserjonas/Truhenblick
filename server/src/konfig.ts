import { resolve } from 'node:path';

export interface Konfig {
  port: number;
  host: string;
  datenVerzeichnis: string;
  /** Optional: Zugangscode der ersten Truhe (siehe app.ts) */
  token: string | undefined;
  /** Dürfen über die App neue Truhen angelegt werden? */
  neueTruhen: boolean;
  maxTruhen: number;
  /** Erlaubte Herkünfte für Browser-Anfragen von einer anderen Adresse; leer = nur gleiche Adresse */
  corsOrigins: string[];
}

export const MIN_TOKEN_LAENGE = 16;

export class KonfigFehler extends Error {}

/** Liest die Einstellungen aus Umgebungsvariablen (siehe .env.example). */
export function leseKonfig(env: NodeJS.ProcessEnv = process.env): Konfig {
  // SYNC_TOKEN ist freiwillig: Normalerweise entsteht der Zugangscode beim Anlegen einer Truhe in der App.
  const token = (env.SYNC_TOKEN ?? '').trim();
  if (token && token.length < MIN_TOKEN_LAENGE) {
    throw new KonfigFehler(
      `SYNC_TOKEN ist zu kurz (mindestens ${MIN_TOKEN_LAENGE} Zeichen). ` +
        'Erzeuge einen z. B. mit:  openssl rand -hex 24  – oder lass die Angabe weg.',
    );
  }
  const schalter = (env.NEUE_TRUHEN ?? 'an').trim().toLowerCase();
  if (!['an', 'aus', '1', '0', 'ja', 'nein'].includes(schalter)) {
    throw new KonfigFehler(`NEUE_TRUHEN muss „an“ oder „aus“ sein, nicht: ${env.NEUE_TRUHEN}`);
  }
  const maxTruhen = Number(env.MAX_TRUHEN ?? 10);
  if (!Number.isInteger(maxTruhen) || maxTruhen < 1) {
    throw new KonfigFehler(`MAX_TRUHEN ist keine gültige Anzahl: ${env.MAX_TRUHEN}`);
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new KonfigFehler(`PORT ist keine gültige Portnummer: ${env.PORT}`);
  }
  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    datenVerzeichnis: resolve(env.DATA_DIR?.trim() || './data'),
    token: token || undefined,
    neueTruhen: ['an', '1', 'ja'].includes(schalter),
    maxTruhen,
    corsOrigins: (env.CORS_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  };
}
