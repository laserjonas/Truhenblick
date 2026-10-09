import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { SyncAnfrage } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import type { Speicher } from './speicher.ts';

export interface AppOptionen {
  speicher: Speicher;
  token: string;
  corsOrigins?: string[];
  version?: string;
}

const MAX_ANFRAGE_BYTES = 5 * 1024 * 1024;
const MAX_FEHLVERSUCHE = 10;
const SPERRZEIT_MS = 10 * 60 * 1000;

function hash(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

/** Bremst das Durchprobieren von Tokens: nach zu vielen Fehlversuchen ist die Adresse eine Weile gesperrt. */
function fehlversuchZaehler() {
  const versuche = new Map<string, { anzahl: number; bis: number }>();
  return {
    gesperrt(adresse: string, jetzt: number): boolean {
      const v = versuche.get(adresse);
      if (!v) return false;
      if (v.bis <= jetzt) {
        versuche.delete(adresse);
        return false;
      }
      return v.anzahl >= MAX_FEHLVERSUCHE;
    },
    merke(adresse: string, jetzt: number): void {
      // Speicher begrenzen, falls sehr viele verschiedene Adressen anklopfen.
      if (versuche.size > 10_000) versuche.clear();
      const v = versuche.get(adresse);
      if (v && v.bis > jetzt) v.anzahl += 1;
      else versuche.set(adresse, { anzahl: 1, bis: jetzt + SPERRZEIT_MS });
    },
    vergiss(adresse: string): void {
      versuche.delete(adresse);
    },
  };
}

/** Prüft die Anfrage und entfernt unbekannte Felder; null, wenn sie nicht dem Protokoll entspricht. */
export function leseSyncAnfrage(roh: unknown): SyncAnfrage | null {
  if (typeof roh !== 'object' || roh === null) return null;
  const { seit, bereiche, artikel } = roh as Record<string, unknown>;
  if (typeof seit !== 'number' || !Number.isInteger(seit) || seit < 0) return null;
  if (!Array.isArray(bereiche) || !Array.isArray(artikel)) return null;
  if (!bereiche.every(istBereich) || !artikel.every(istArtikel)) return null;
  return { seit, bereiche: bereiche.map(bereinigeBereich), artikel: artikel.map(bereinigeArtikel) };
}

export function erstelleApp({ speicher, token, corsOrigins = [], version = 'dev' }: AppOptionen): Hono {
  const app = new Hono();
  const erwartet = hash(token);
  const zaehler = fehlversuchZaehler();

  if (corsOrigins.length > 0) {
    app.use(
      '/api/*',
      cors({
        origin: corsOrigins.includes('*') ? '*' : corsOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: 86_400,
      }),
    );
  }

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // Ohne Anmeldung: zeigt nur, dass hier ein Truhenblick-Server läuft.
  app.get('/api/health', (c) => c.json({ ok: true, app: 'truhenblick', version }));

  app.use('/api/sync', async (c, next) => {
    // Hinter dem Reverse Proxy steht die echte Adresse in X-Forwarded-For.
    const weitergeleitet = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    let adresse = weitergeleitet || 'unbekannt';
    if (!weitergeleitet) {
      try {
        adresse = getConnInfo(c).remote.address ?? 'unbekannt';
      } catch {
        // Kein Socket (z. B. in Tests) – dann zählen alle gemeinsam.
      }
    }
    const jetzt = Date.now();
    if (zaehler.gesperrt(adresse, jetzt)) {
      return c.json({ fehler: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' }, 429);
    }
    const kopf = c.req.header('authorization') ?? '';
    const gesendet = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
    if (!gesendet || !timingSafeEqual(hash(gesendet), erwartet)) {
      zaehler.merke(adresse, jetzt);
      return c.json({ fehler: 'Zugangs-Token fehlt oder ist falsch.' }, 401);
    }
    zaehler.vergiss(adresse);
    await next();
  });

  app.post(
    '/api/sync',
    bodyLimit({
      maxSize: MAX_ANFRAGE_BYTES,
      onError: (c) => c.json({ fehler: 'Die Anfrage ist zu groß.' }, 413),
    }),
    async (c) => {
      let roh: unknown;
      try {
        roh = await c.req.json();
      } catch {
        return c.json({ fehler: 'Die Anfrage ist kein gültiges JSON.' }, 400);
      }
      const anfrage = leseSyncAnfrage(roh);
      if (!anfrage) return c.json({ fehler: 'Die Anfrage entspricht nicht dem Sync-Protokoll.' }, 400);
      return c.json(speicher.sync(anfrage));
    },
  );

  app.notFound((c) => c.json({ fehler: 'Nicht gefunden.' }, 404));
  app.onError((fehler, c) => {
    console.error('Unerwarteter Fehler:', fehler);
    return c.json({ fehler: 'Interner Fehler.' }, 500);
  });

  return app;
}
