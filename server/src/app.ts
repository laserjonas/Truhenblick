import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { SyncAnfrage, UpdateStand } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import type { Speicher } from './speicher.ts';
import type { UpdateDienst } from './update.ts';

export interface AppOptionen {
  speicher: Speicher;
  /** Zugangscode aus der Konfiguration (SYNC_TOKEN) */
  token: string;
  corsOrigins?: string[];
  version?: string;
  /** Meldungen fürs Protokoll (Standard: Konsole) */
  melde?: (text: string) => void;
  /** Aktualisierung aus der App; ohne Angabe meldet der Server, dass sie nicht möglich ist */
  update?: UpdateDienst;
}

const NICHT_MOEGLICH: UpdateStand = {
  moeglich: false,
  installiert: null,
  verfuegbar: null,
  neu: null,
  geprueft: null,
  laeuft: false,
  letztes: null,
  protokoll: null,
};

const MAX_ANFRAGE_BYTES = 5 * 1024 * 1024;
const MAX_FEHLVERSUCHE = 10;
const SPERRZEIT_MS = 10 * 60 * 1000;

function hash(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

/** Zeichen ohne Verwechslungsgefahr (kein 0/o, 1/l/i) – der Code wird auf anderen Geräten abgetippt. */
const CODE_ZEICHEN = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Neuer Zugangscode in der Form „k7m2-9xqp-4hrt-w3vn-8dzj“ (rund 99 Bit Zufall). */
export function erzeugeCode(): string {
  const gruppen: string[] = [];
  for (let g = 0; g < 5; g++) {
    let gruppe = '';
    for (let i = 0; i < 4; i++) gruppe += CODE_ZEICHEN[randomInt(CODE_ZEICHEN.length)];
    gruppen.push(gruppe);
  }
  return gruppen.join('-');
}

/** Bremst das Durchprobieren von Codes: nach zu vielen Fehlversuchen ist die Adresse eine Weile gesperrt. */
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

export function erstelleApp({
  speicher,
  token,
  corsOrigins = [],
  version = 'dev',
  melde = console.log,
  update,
}: AppOptionen): Hono {
  const app = new Hono();
  const zaehler = fehlversuchZaehler();

  // Welcher Code gilt?
  // - Wurde in der App ein neuer erzeugt, gilt dieser – solange SYNC_TOKEN seither unverändert ist.
  // - Wird SYNC_TOKEN auf dem Server geändert, gilt wieder dieser. So lässt sich der Zugang
  //   jederzeit von der Serverseite aus zurücksetzen, auch wenn kein Gerät den Code mehr kennt.
  const envHash = hash(token);
  let erwartet = envHash;
  const gespeichert = speicher.codeLesen();
  if (gespeichert) {
    if (gespeichert.envHash === envHash.toString('hex')) {
      erwartet = Buffer.from(gespeichert.codeHash, 'hex');
      melde('Es gilt der in der App erzeugte Zugangscode (nicht SYNC_TOKEN aus der Konfiguration).');
    } else {
      speicher.codeLoeschen();
      melde('SYNC_TOKEN wurde geändert – der zuvor in der App erzeugte Zugangscode gilt nicht mehr.');
    }
  }

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

  const anmeldung: MiddlewareHandler = async (c, next) => {
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
      return c.json({ fehler: 'Zugangscode fehlt oder ist falsch.' }, 401);
    }
    zaehler.vergiss(adresse);
    await next();
  };
  app.use('/api/sync', anmeldung);
  app.use('/api/code', anmeldung);
  app.use('/api/update', anmeldung);

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

  // Erzeugt einen neuen Zugangscode. Der bisherige gilt sofort nicht mehr; nur das anfragende
  // Gerät erfährt den neuen. Auf dem Server bleibt allein seine Prüfsumme.
  app.post('/api/code', (c) => {
    const code = erzeugeCode();
    const codeHash = hash(code);
    speicher.codeSchreiben({ codeHash: codeHash.toString('hex'), envHash: envHash.toString('hex') });
    erwartet = codeHash;
    melde('Der Zugangscode wurde über die App neu erzeugt.');
    return c.json({ code });
  });

  // Stand der Aktualisierung; mit ?pruefen=1 wird die Quelle sofort abgefragt.
  app.get('/api/update', async (c) => {
    if (!update) return c.json(NICHT_MOEGLICH);
    return c.json(await update.stand(c.req.query('pruefen') === '1'));
  });

  // Stößt das Update an. Ausgeführt wird es von einem eigenen Dienst mit root-Rechten
  // (siehe update.ts) – diese Anfrage kann nichts daran beeinflussen außer dem Zeitpunkt.
  app.post('/api/update', async (c) => {
    const ergebnis = update ? await update.starte() : 'nicht-moeglich';
    if (ergebnis === 'nicht-moeglich') {
      return c.json({ fehler: 'Dieser Server lässt sich nicht aus der App aktualisieren.' }, 409);
    }
    if (ergebnis === 'gestartet') melde('Ein Update wurde aus der App angestoßen.');
    return c.json({ gestartet: ergebnis === 'gestartet', laeuft: true }, 202);
  });

  app.notFound((c) => c.json({ fehler: 'Nicht gefunden.' }, 404));
  app.onError((fehler, c) => {
    console.error('Unerwarteter Fehler:', fehler);
    return c.json({ fehler: 'Interner Fehler.' }, 500);
  });

  return app;
}
