import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Erreichbarkeit, ServerAuskunft, ServerEinstellungen, SyncAnfrage, UpdateStand } from '../../shared/types.ts';
import { berechneUebersicht, heuteIn } from '../../shared/uebersicht.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import { clientAdresse, istIp, leseRechnername } from './adresse.ts';
import { erzeugeSitzung, MAX_PASSWORT_LAENGE, MIN_PASSWORT_LAENGE, passwortHash, passwortStimmt } from './passwort.ts';
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
  /**
   * Startwerte für Adresse und Erreichbarkeit – sie gelten nur, solange in der App noch nichts
   * eingestellt wurde (z. B. nach einem Update von einer älteren Installation).
   */
  startAdresse?: string;
  startErreichbarkeit?: Erreichbarkeit;
  /** Uhr in Millisekunden – in Tests verstellbar */
  jetzt?: () => number;
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
/**
 * Falsche Passwörter aller Adressen zusammen: Wer seine Adresse wechselt oder fälscht, kommt so
 * trotzdem nicht schneller voran. Angemeldete Geräte merken von dieser Sperre nichts.
 */
const MAX_ANMELDEVERSUCHE_ALLE = 30;
/** Eine Anmeldung gilt, solange das Gerät sie mindestens alle 90 Tage benutzt. */
const SITZUNG_GUELTIG_MS = 90 * 24 * 60 * 60 * 1000;
const SITZUNG_KOPF = 'x-truhenblick-sitzung';
/** Für Anfragen, die nur ein paar Felder tragen */
const MAX_KLEIN_BYTES = 10_000;
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
  startAdresse,
  startErreichbarkeit,
  jetzt = Date.now,
}: AppOptionen) {
  const app = new Hono<Umgebung>();
  const fehlversuche = zaehler(MAX_FEHLVERSUCHE, SPERRZEIT_MS);
  const neuanlagen = zaehler(MAX_NEUE_TRUHEN_JE_STUNDE, 60 * 60 * 1000);
  const anmeldeVersuche = zaehler(MAX_FEHLVERSUCHE, SPERRZEIT_MS);
  const anmeldeVersucheAlle = zaehler(MAX_ANMELDEVERSUCHE_ALLE, SPERRZEIT_MS);

  // ------------------------------------------------------------ Einstellungen aus der App

  const erreichbarkeit = (): Erreichbarkeit => {
    const wert = speicher.einstellung('erreichbarkeit');
    return wert === 'proxy' || wert === 'selbst' ? wert : 'heimnetz';
  };
  const adresse = () => speicher.einstellung('adresse') ?? '';
  /** Prüfsumme des Passworts – null, solange keine Anmeldung verlangt wird */
  const passwort = () => speicher.einstellung('passwort');

  if (speicher.einstellung('erreichbarkeit') === null && startErreichbarkeit && startErreichbarkeit !== 'heimnetz') {
    const name = leseRechnername(startAdresse ?? '');
    if (name) {
      speicher.einstellungSetzen('adresse', name);
      speicher.einstellungSetzen('erreichbarkeit', startErreichbarkeit);
      melde(`Adresse aus der Konfiguration übernommen: ${name} (${startErreichbarkeit}). Ändern lässt sie sich in der App.`);
    }
  }

  let kennung = speicher.einstellung('kennung');
  if (!kennung) {
    kennung = randomBytes(9).toString('base64url');
    speicher.einstellungSetzen('kennung', kennung);
  }

  /** Adresse des Geräts, dem eine Anfrage zugerechnet wird (siehe adresse.ts). */
  function adresseVon(c: Context): string {
    let verbindung: string | undefined;
    try {
      verbindung = getConnInfo(c).remote.address;
    } catch {
      // Kein Socket (z. B. in Tests) – dann zählen alle gemeinsam.
    }
    return clientAdresse(c.req.header('x-forwarded-for'), verbindung, erreichbarkeit() === 'proxy');
  }

  const sitzungVon = (c: Context): string | null => {
    const wert = c.req.header(SITZUNG_KOPF)?.trim();
    return wert ? hash(wert) : null;
  };
  /** Ohne Passwort auf dem Server gilt jede Anfrage als angemeldet. */
  const angemeldet = (c: Context): boolean => {
    if (!passwort()) return true;
    const sitzung = sitzungVon(c);
    const t = jetzt();
    return sitzung !== null && speicher.sitzungGueltig(sitzung, t, t - SITZUNG_GUELTIG_MS);
  };
  const klein = bodyLimit({
    maxSize: MAX_KLEIN_BYTES,
    onError: (c) => c.json({ fehler: 'Die Anfrage ist zu groß.' }, 413),
  });
  /** Liest ein JSON-Objekt aus der Anfrage; null, wenn es keines ist. */
  const leseObjekt = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      const roh: unknown = await c.req.json();
      return typeof roh === 'object' && roh !== null && !Array.isArray(roh) ? (roh as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

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
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'X-Truhenblick-Sitzung'],
        maxAge: 86_400,
      }),
    );
  }

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // Ohne Anmeldung: zeigt, dass hier ein Truhenblick-Server läuft, ob er neue Truhen annimmt und
  // ob er ein Passwort verlangt. Darf von jeder Seite gelesen werden – so prüft die App, ob unter
  // der eingestellten Adresse wirklich dieser Server antwortet.
  app.get('/api/health', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    const art = erreichbarkeit();
    return c.json({
      ok: true,
      app: 'truhenblick',
      version,
      neueTruhen: darfAnlegen(),
      anmeldung: Boolean(passwort()),
      angemeldet: angemeldet(c),
      erreichbarkeit: art,
      adresse: art === 'heimnetz' ? null : adresse() || null,
      kennung,
    } satisfies ServerAuskunft);
  });

  // Mit einem Passwort geschützt, antwortet der Server Unangemeldeten nur noch auf das Nötigste:
  // die Auskunft oben, die Anmeldung selbst, die Übersicht für Home Assistant (eigener Schlüssel)
  // und die Rückfrage des eigenen Webservers.
  const OHNE_ANMELDUNG = new Set(['/api/health', '/api/anmelden', '/api/uebersicht', '/api/zertifikat']);
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' && !OHNE_ANMELDUNG.has(c.req.path) && !angemeldet(c)) {
      return c.json({ fehler: 'Bitte melde dich an.', art: 'anmeldung' }, 401);
    }
    await next();
  });

  // Anmelden mit dem Passwort des Servers. Das Gerät bekommt eine Kennung, die es künftig mitschickt;
  // auf dem Server liegt nur deren Prüfsumme.
  app.post('/api/anmelden', klein, async (c) => {
    const gespeichert = passwort();
    if (!gespeichert) return c.json({ fehler: 'Auf diesem Server ist keine Anmeldung eingerichtet.' }, 409);
    const von = adresseVon(c);
    const t = jetzt();
    if (anmeldeVersuche.erreicht(von, t) || anmeldeVersucheAlle.erreicht('alle', t)) {
      return c.json({ fehler: 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.' }, 429);
    }
    const eingabe = (await leseObjekt(c))?.passwort;
    if (typeof eingabe !== 'string' || eingabe.length === 0 || eingabe.length > MAX_PASSWORT_LAENGE) {
      return c.json({ fehler: 'Bitte gib das Passwort ein.' }, 400);
    }
    if (!(await passwortStimmt(eingabe, gespeichert))) {
      anmeldeVersuche.merke(von, t);
      anmeldeVersucheAlle.merke('alle', t);
      return c.json({ fehler: 'Das Passwort stimmt nicht.' }, 401);
    }
    anmeldeVersuche.vergiss(von);
    const sitzung = erzeugeSitzung();
    speicher.sitzungAnlegen(hash(sitzung), t, t - SITZUNG_GUELTIG_MS);
    return c.json({ sitzung });
  });

  // Meldet dieses Gerät ab.
  app.post('/api/abmelden', (c) => {
    const sitzung = sitzungVon(c);
    if (sitzung) speicher.sitzungBeenden(sitzung);
    return c.json({ angemeldet: false });
  });

  // Der eigene Webserver (Caddy) fragt hier nach, bevor er für einen Namen ein Zertifikat holt.
  // Erlaubt ist nur die in der App eingestellte Adresse – und nur, wenn Truhenblick sich selbst
  // um HTTPS kümmern soll. Anfragen von außen tragen X-Forwarded-For und bekommen keine Auskunft.
  app.get('/api/zertifikat', (c) => {
    if (c.req.header('x-forwarded-for')) return c.json({ fehler: 'Nicht gefunden.' }, 404);
    const name = (c.req.query('domain') ?? '').trim().toLowerCase();
    const erlaubt = erreichbarkeit() === 'selbst' && name !== '' && name === adresse();
    return erlaubt ? c.text('ja') : c.text('nein', 403);
  });

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
  const mitCode: MiddlewareHandler<Umgebung> = async (c, next) => {
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
  app.use('/api/sync', mitCode);
  app.use('/api/code', mitCode);
  app.use('/api/update', mitCode);
  app.use('/api/lesezugang', mitCode);
  app.use('/api/server', mitCode);
  app.use('/api/passwort', mitCode);
  app.use('/api/sitzungen', mitCode);

  // Die Übersicht darf auch mit dem Lese-Schlüssel abgerufen werden – er öffnet sonst nichts.
  const leseAnmeldung: MiddlewareHandler<Umgebung> = async (c, next) => {
    const adresse = adresseVon(c);
    const jetzt = Date.now();
    if (fehlversuche.erreicht(adresse, jetzt)) {
      return c.json({ fehler: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' }, 429);
    }
    const kopf = c.req.header('authorization') ?? '';
    const gesendet = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
    const pruefsumme = gesendet ? hash(gesendet) : '';
    const truhe = gesendet ? (speicher.truheMitLeseSchluessel(pruefsumme) ?? speicher.truheMitCode(pruefsumme)) : null;
    if (!truhe) {
      fehlversuche.merke(adresse, jetzt);
      return c.json({ fehler: 'Lese-Schlüssel fehlt oder ist falsch.' }, 401);
    }
    fehlversuche.vergiss(adresse);
    c.set('truhe', truhe);
    await next();
  };
  app.use('/api/uebersicht', leseAnmeldung);

  // Übersicht für Home Assistant & Co.: Zähler und die Liste dessen, was bald abläuft.
  //   ?zeitzone=Europe/Berlin  bestimmt, welcher Tag „heute“ ist (Standard: Zeitzone des Servers)
  //   ?tage=14                 Schwelle für „bald fällig“ (Standard: wie in der App)
  //   ?limit=20                Höchstzahl der Einträge in der Liste
  app.get('/api/uebersicht', (c) => {
    const zahl = (name: string, min: number, max: number): number | undefined | null => {
      const roh = c.req.query(name);
      if (roh === undefined || roh === '') return undefined;
      const n = Number(roh);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const tage = zahl('tage', 0, 3650);
    const limit = zahl('limit', 0, 200);
    if (tage === null || limit === null) return c.json({ fehler: 'tage und limit müssen ganze Zahlen sein.' }, 400);

    let heute: string;
    try {
      heute = heuteIn(c.req.query('zeitzone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      return c.json({ fehler: 'Unbekannte Zeitzone. Beispiel: zeitzone=Europe/Berlin' }, 400);
    }
    const { bereiche, artikel } = speicher.bestand(c.get('truhe').id);
    return c.json(berechneUebersicht(bereiche, artikel, heute, { tage, limit }));
  });

  // Lese-Schlüssel verwalten (nur mit dem Zugangscode der Truhe).
  app.get('/api/lesezugang', (c) => c.json({ aktiv: speicher.hatLeseSchluessel(c.get('truhe').id) }));
  app.post('/api/lesezugang', (c) => {
    // Ein neuer Schlüssel ersetzt den bisherigen.
    const schluessel = `lese-${erzeugeCode()}`;
    speicher.leseSchluesselSetzen(c.get('truhe').id, hash(schluessel));
    melde('Ein Lese-Schlüssel wurde erzeugt.');
    return c.json({ schluessel });
  });
  app.delete('/api/lesezugang', (c) => {
    speicher.leseSchluesselSetzen(c.get('truhe').id, null);
    melde('Ein Lese-Schlüssel wurde widerrufen.');
    return c.json({ aktiv: false });
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

  // ------------------------------------------------------------ Einstellungen des Servers

  const NUR_BETREIBER = 'Die Einstellungen des Servers ändern nur die Geräte der zuerst angelegten Truhe.';

  function einstellungen(c: Context<Umgebung>): ServerEinstellungen {
    const betreiber = istBetreiber(c);
    const kette = (c.req.header('x-forwarded-for') ?? '').split(',').filter((e) => istIp(e));
    return {
      betreiber,
      erreichbarkeit: erreichbarkeit(),
      adresse: betreiber ? adresse() : '',
      anmeldung: Boolean(passwort()),
      sitzungen: betreiber ? speicher.anzahlSitzungen() : 0,
      anfrage: {
        host: (c.req.header('host') ?? '').replace(/:\d+$/, ''),
        https: c.req.header('x-forwarded-proto') === 'https',
        ueberProxy: kette.length > 1,
      },
    };
  }

  app.get('/api/server', (c) => c.json(einstellungen(c)));

  // Adresse und Erreichbarkeit. Am Webserver ändert sich dadurch nichts – er antwortet weiter unter
  // jeder Adresse; für „selbst“ holt er das Zertifikat, sobald die Adresse zum ersten Mal aufgerufen wird.
  app.post('/api/server', klein, async (c) => {
    if (!istBetreiber(c)) return c.json({ fehler: NUR_BETREIBER }, 403);
    const eingabe = await leseObjekt(c);
    const art = eingabe?.erreichbarkeit;
    if (art !== 'heimnetz' && art !== 'proxy' && art !== 'selbst') {
      return c.json({ fehler: 'Die Anfrage nennt keine gültige Erreichbarkeit.' }, 400);
    }
    const name = typeof eingabe?.adresse === 'string' ? leseRechnername(eingabe.adresse) : null;
    if (art !== 'heimnetz' && !name) {
      return c.json({ fehler: 'Das ist keine gültige Adresse. Gemeint ist der Name ohne https://, zum Beispiel truhe.example.de' }, 400);
    }
    if (name) speicher.einstellungSetzen('adresse', name);
    speicher.einstellungSetzen('erreichbarkeit', art);
    melde(`Erreichbarkeit in der App eingestellt: ${art}${art === 'heimnetz' ? '' : ` (${name})`}.`);
    return c.json(einstellungen(c));
  });

  // Legt das Passwort fest, ändert es oder schaltet die Anmeldung ab (passwort: null).
  // Alle Geräte müssen sich danach neu anmelden – das anfragende bekommt gleich eine neue Kennung.
  app.post('/api/passwort', klein, async (c) => {
    if (!istBetreiber(c)) return c.json({ fehler: NUR_BETREIBER }, 403);
    const eingabe = await leseObjekt(c);
    const neu = eingabe?.passwort;
    if (neu === null) {
      speicher.einstellungSetzen('passwort', null);
      speicher.sitzungenBeenden();
      melde('Die Anmeldung wurde in der App abgeschaltet.');
      return c.json({ anmeldung: false });
    }
    if (typeof neu !== 'string' || neu.length < MIN_PASSWORT_LAENGE) {
      return c.json({ fehler: `Das Passwort braucht mindestens ${MIN_PASSWORT_LAENGE} Zeichen.` }, 400);
    }
    if (neu.length > MAX_PASSWORT_LAENGE) {
      return c.json({ fehler: `Das Passwort darf höchstens ${MAX_PASSWORT_LAENGE} Zeichen haben.` }, 400);
    }
    speicher.einstellungSetzen('passwort', await passwortHash(neu));
    speicher.sitzungenBeenden();
    const sitzung = erzeugeSitzung();
    const t = jetzt();
    speicher.sitzungAnlegen(hash(sitzung), t, t - SITZUNG_GUELTIG_MS);
    melde('Das Passwort für die Anmeldung wurde in der App festgelegt.');
    return c.json({ anmeldung: true, sitzung });
  });

  // Meldet alle anderen Geräte ab.
  app.delete('/api/sitzungen', (c) => {
    if (!istBetreiber(c)) return c.json({ fehler: NUR_BETREIBER }, 403);
    speicher.sitzungenBeenden(sitzungVon(c) ?? undefined);
    return c.json({ sitzungen: speicher.anzahlSitzungen() });
  });

  app.notFound((c) => c.json({ fehler: 'Nicht gefunden.' }, 404));
  app.onError((fehler, c) => {
    console.error('Unerwarteter Fehler:', fehler);
    return c.json({ fehler: 'Interner Fehler.' }, 500);
  });

  return app;
}
