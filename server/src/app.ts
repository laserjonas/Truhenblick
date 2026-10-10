import { createHash, randomInt } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { SyncAnfrage, UpdateStand } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import type { Speicher, Truhe } from './speicher.ts';
import type { UpdateDienst } from './update.ts';

export interface AppOptionen {
  speicher: Speicher;
  /**
   * SYNC_TOKEN aus der Konfiguration (optional). Ist er gesetzt, ist er der Zugangscode der
   * ersten Truhe: Beim ersten Start wird sie damit angelegt, und wer ihn später ändert, setzt
   * ihren Code darauf zurück.
   */
  token?: string;
  /** Dürfen über die App neue Truhen angelegt werden? (Standard: ja) */
  neueTruhen?: boolean;
  /** Obergrenze für die Zahl der Truhen auf diesem Server */
  maxTruhen?: number;
  corsOrigins?: string[];
  version?: string;
  /** Meldungen fürs Protokoll (Standard: Konsole) */
  melde?: (text: string) => void;
  /** Aktualisierung aus der App; ohne Angabe meldet der Server, dass sie nicht möglich ist */
  update?: UpdateDienst;
}

type Umgebung = { Variables: { truhe: Truhe } };

const NICHT_MOEGLICH: UpdateStand = {
  moeglich: false,
  grund: 'nicht-eingerichtet',
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
/** So viele Truhen darf eine Adresse pro Stunde anlegen. */
const MAX_NEUE_TRUHEN_JE_STUNDE = 5;

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
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

/** Zählt Ereignisse je Adresse in einem Zeitfenster – bremst das Durchprobieren von Codes und Massenanlagen. */
function zaehler(grenze: number, fensterMs: number) {
  const eintraege = new Map<string, { anzahl: number; bis: number }>();
  return {
    erreicht(adresse: string, jetzt: number): boolean {
      const e = eintraege.get(adresse);
      if (!e) return false;
      if (e.bis <= jetzt) {
        eintraege.delete(adresse);
        return false;
      }
      return e.anzahl >= grenze;
    },
    merke(adresse: string, jetzt: number): void {
      // Speicher begrenzen, falls sehr viele verschiedene Adressen anklopfen.
      if (eintraege.size > 10_000) eintraege.clear();
      const e = eintraege.get(adresse);
      if (e && e.bis > jetzt) e.anzahl += 1;
      else eintraege.set(adresse, { anzahl: 1, bis: jetzt + fensterMs });
    },
    vergiss(adresse: string): void {
      eintraege.delete(adresse);
    },
  };
}

/** Adresse des Geräts – hinter dem Reverse Proxy steht die echte in X-Forwarded-For. */
function adresseVon(c: Context): string {
  const weitergeleitet = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (weitergeleitet) return weitergeleitet;
  try {
    return getConnInfo(c).remote.address ?? 'unbekannt';
  } catch {
    // Kein Socket (z. B. in Tests) – dann zählen alle gemeinsam.
    return 'unbekannt';
  }
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
  neueTruhen = true,
  maxTruhen = 10,
  corsOrigins = [],
  version = 'dev',
  melde = console.log,
  update,
}: AppOptionen) {
  const app = new Hono<Umgebung>();
  const fehlversuche = zaehler(MAX_FEHLVERSUCHE, SPERRZEIT_MS);
  const neuanlagen = zaehler(MAX_NEUE_TRUHEN_JE_STUNDE, 60 * 60 * 1000);

  // SYNC_TOKEN aus der Konfiguration gehört zur ersten Truhe:
  // - Gibt es noch keine, wird sie damit angelegt.
  // - Wurde er geändert, bekommt die erste Truhe ihn als Code. So lässt sich der Zugang von der
  //   Serverseite zurücksetzen, wenn kein Gerät den Code mehr kennt.
  // - Ist er unverändert, bleibt ein inzwischen in der App erzeugter Code gültig.
  if (token) {
    const envHash = hash(token);
    const erste = speicher.ersteTruhe();
    if (!erste) {
      speicher.truheAnlegen(envHash);
      speicher.envHashSchreiben(envHash);
      melde('Erste Truhe angelegt; ihr Zugangscode ist SYNC_TOKEN aus der Konfiguration.');
    } else if (speicher.envHashLesen() !== envHash) {
      if (speicher.truheMitCode(envHash)?.id !== erste.id) speicher.codeSetzen(erste.id, envHash);
      speicher.envHashSchreiben(envHash);
      melde('SYNC_TOKEN gilt jetzt als Zugangscode der ersten Truhe.');
    }
  }

  const darfAnlegen = () => neueTruhen && speicher.anzahlTruhen() < maxTruhen;

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

  // Ohne Anmeldung: zeigt, dass hier ein Truhenblick-Server läuft und ob er neue Truhen annimmt.
  app.get('/api/health', (c) => c.json({ ok: true, app: 'truhenblick', version, neueTruhen: darfAnlegen() }));

  // Legt eine neue, leere Truhe an und liefert ihren Zugangscode – das Gegenstück zu „Truhe
  // anlegen“ in der App. Bewusst ohne Anmeldung: Wer den Server erreicht, darf eine eigene
  // Truhe beginnen, kommt damit aber an keine andere heran. Begrenzt durch Höchstzahl und Tempo;
  // abschaltbar mit NEUE_TRUHEN=aus.
  app.post('/api/truhen', (c) => {
    if (!neueTruhen) return c.json({ fehler: 'Auf diesem Server lassen sich keine neuen Truhen anlegen.' }, 403);
    if (speicher.anzahlTruhen() >= maxTruhen) {
      return c.json({ fehler: 'Auf diesem Server ist die Höchstzahl an Truhen erreicht.' }, 403);
    }
    const adresse = adresseVon(c);
    const jetzt = Date.now();
    if (neuanlagen.erreicht(adresse, jetzt)) {
      return c.json({ fehler: 'Zu viele neue Truhen in kurzer Zeit. Bitte später erneut versuchen.' }, 429);
    }
    neuanlagen.merke(adresse, jetzt);
    const code = erzeugeCode();
    speicher.truheAnlegen(hash(code));
    melde(`Neue Truhe angelegt (jetzt ${speicher.anzahlTruhen()}).`);
    return c.json({ code }, 201);
  });

  // Der Zugangscode ist zugleich die Angabe, um welche Truhe es geht.
  const anmeldung: MiddlewareHandler<Umgebung> = async (c, next) => {
    const adresse = adresseVon(c);
    const jetzt = Date.now();
    if (fehlversuche.erreicht(adresse, jetzt)) {
      return c.json({ fehler: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' }, 429);
    }
    const kopf = c.req.header('authorization') ?? '';
    const gesendet = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
    // Gesucht wird über die Prüfsumme – der Code selbst liegt nirgends auf dem Server.
    const truhe = gesendet ? speicher.truheMitCode(hash(gesendet)) : null;
    if (!truhe) {
      fehlversuche.merke(adresse, jetzt);
      return c.json({ fehler: 'Zugangscode fehlt oder ist falsch.' }, 401);
    }
    fehlversuche.vergiss(adresse);
    c.set('truhe', truhe);
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
      return c.json(speicher.sync(c.get('truhe').id, anfrage));
    },
  );

  // Erzeugt einen neuen Zugangscode für diese Truhe. Der bisherige gilt sofort nicht mehr; nur das
  // anfragende Gerät erfährt den neuen. Auf dem Server bleibt allein seine Prüfsumme.
  app.post('/api/code', (c) => {
    const code = erzeugeCode();
    speicher.codeSetzen(c.get('truhe').id, hash(code));
    melde('Ein Zugangscode wurde über die App neu erzeugt.');
    return c.json({ code });
  });

  // Den Server aktualisieren darf nur die zuerst angelegte Truhe – die des Betreibers. Sonst könnte
  // jeder, der eine eigene Truhe anlegt, Updates auslösen.
  const istBetreiber = (c: Context<Umgebung>) => c.get('truhe').id === speicher.ersteTruhe()?.id;

  // Stand der Aktualisierung; mit ?pruefen=1 wird die Quelle sofort abgefragt.
  app.get('/api/update', async (c) => {
    if (!update) return c.json(NICHT_MOEGLICH);
    if (!istBetreiber(c)) return c.json({ ...NICHT_MOEGLICH, grund: 'andere-truhe' } satisfies UpdateStand);
    return c.json(await update.stand(c.req.query('pruefen') === '1'));
  });

  // Stößt das Update an. Ausgeführt wird es von einem eigenen Dienst mit root-Rechten
  // (siehe update.ts) – diese Anfrage kann nichts daran beeinflussen außer dem Zeitpunkt.
  app.post('/api/update', async (c) => {
    if (!istBetreiber(c)) {
      return c.json({ fehler: 'Den Server kann nur die zuerst angelegte Truhe aktualisieren.' }, 403);
    }
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
