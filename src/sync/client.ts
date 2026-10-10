import { eingehendeGewinnt } from '../../shared/sync.ts';
import type { Artikel, Bereich, Erreichbarkeit, ServerEinstellungen, SyncAnfrage, SyncAntwort, SyncDoc, UpdateStand } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import { db, metaLesen, metaSchreiben, ohneLokal, type Lokal } from '../db/db.ts';

export interface SyncKonfig {
  /** Adresse des Servers ohne /api; leer = dieselbe Adresse, von der die App geladen wurde */
  url: string;
  token: string;
}

export class SyncFehler extends Error {
  /** „anmeldung“: Der Server verlangt ein Passwort, und dieses Gerät ist nicht (mehr) angemeldet. */
  art: 'token' | 'netz' | 'server' | 'gesperrt' | 'anmeldung';

  constructor(art: SyncFehler['art'], meldung: string) {
    super(meldung);
    this.art = art;
  }
}

const KONFIG = 'sync.konfig';
const REV = 'sync.rev';
const SERVER_ID = 'sync.serverId';
const LETZTER_ERFOLG = 'sync.letzterErfolg';
const SITZUNG = 'sync.sitzung';

/** Die Anmeldung dieses Geräts – sie gilt nur für den Server, bei dem sie entstanden ist. */
interface Sitzung {
  url: string;
  wert: string;
}

async function sitzungFuer(url: string): Promise<string | null> {
  const sitzung = await metaLesen<Sitzung>(SITZUNG);
  return sitzung && sitzung.url === url ? sitzung.wert : null;
}

let beiFehlenderAnmeldung: (() => void) | null = null;

/** Wird gerufen, sobald der Server eine Anfrage abweist, weil die Anmeldung fehlt. */
export function horcheAufFehlendeAnmeldung(fn: (() => void) | null): void {
  beiFehlenderAnmeldung = fn;
}

/** Macht aus der Eingabe eine saubere Basisadresse: „truhe.example.de/api/“ → „https://truhe.example.de“. */
export function normalisiereUrl(eingabe: string): string {
  let url = eingabe.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/api(\/sync)?$/i, '').replace(/\/+$/, '');
}

export async function ladeKonfig(): Promise<SyncKonfig | null> {
  return (await metaLesen<SyncKonfig>(KONFIG)) ?? null;
}

export async function letzterErfolg(): Promise<string | null> {
  return (await metaLesen<string>(LETZTER_ERFOLG)) ?? null;
}

/** Schlüssel des Merkers „frisch angelegte Truhe: Code einmal groß zeigen“ (siehe NeueTruheHinweis). */
export const CODE_HINWEIS = 'sync.codeHinweis';

export async function merkeCodeHinweis(an: boolean): Promise<void> {
  if (an) await metaSchreiben(CODE_HINWEIS, true);
  else await db.meta.delete(CODE_HINWEIS);
}

/**
 * Speichert die Verbindung. Der bekannte Serverstand wird verworfen und alles
 * Lokale vorgemerkt: Der nächste Abgleich holt alles und lädt alles hoch – so
 * stimmt es auch, wenn es ein anderer Server ist als zuvor.
 */
export async function speichereKonfig(konfig: SyncKonfig): Promise<void> {
  await db.transaction('rw', db.meta, db.bereiche, db.artikel, async () => {
    await metaSchreiben(KONFIG, konfig);
    await db.meta.bulkDelete([REV, SERVER_ID, LETZTER_ERFOLG]);
    await allesVormerken();
  });
}

/** Trennt die Verbindung. Die lokalen Daten bleiben erhalten und werden für eine spätere Verbindung vorgemerkt. */
export async function entferneKonfig(): Promise<void> {
  await db.transaction('rw', db.meta, db.bereiche, db.artikel, async () => {
    await db.meta.bulkDelete([KONFIG, REV, SERVER_ID, LETZTER_ERFOLG, CODE_HINWEIS, LESE_SCHLUESSEL]);
    await allesVormerken();
  });
}

async function allesVormerken(): Promise<void> {
  await db.bereiche.toCollection().modify({ dirty: 1 });
  await db.artikel.toCollection().modify({ dirty: 1 });
}

export type Sende = (konfig: SyncKonfig, anfrage: SyncAnfrage) => Promise<SyncAntwort>;

const KEIN_SERVER = 'Unter dieser Adresse antwortet kein Truhenblick-Server.';

/**
 * Anfrage an das Backend; übersetzt Fehler in verständliche Meldungen.
 * Mit `koerper` wird per POST gesendet, sonst per GET. `bei404` ersetzt die Meldung für „unbekannt“.
 */
async function rufe(
  konfig: SyncKonfig,
  pfad: string,
  koerper?: unknown,
  bei404?: string,
  methode?: 'DELETE',
  bei401?: string,
): Promise<Record<string, unknown>> {
  const sitzung = await sitzungFuer(konfig.url);
  let antwort: Response;
  try {
    antwort = await fetch(`${konfig.url}${pfad}`, {
      method: methode ?? (koerper === undefined ? 'GET' : 'POST'),
      headers: {
        // Ohne Code (Truhe anlegen, Server prüfen) wird keine Anmeldung mitgeschickt.
        ...(konfig.token ? { Authorization: `Bearer ${konfig.token}` } : {}),
        ...(sitzung ? { 'X-Truhenblick-Sitzung': sitzung } : {}),
        ...(koerper === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SyncFehler('netz', 'Der Server ist nicht erreichbar.');
  }
  if (antwort.status === 401) {
    // Der Server unterscheidet: Anmeldung fehlt (Passwort) – oder der Code der Truhe stimmt nicht.
    const absage = await absageVon(antwort);
    if (absage.art === 'anmeldung') {
      beiFehlenderAnmeldung?.();
      throw new SyncFehler('anmeldung', 'Dieser Server verlangt eine Anmeldung.');
    }
    throw new SyncFehler('token', bei401 ?? 'Der Zugangscode stimmt nicht.');
  }
  if (antwort.status === 429) {
    throw new SyncFehler('gesperrt', (await serverMeldung(antwort)) ?? 'Zu viele Versuche – bitte in einigen Minuten erneut versuchen.');
  }
  if (antwort.status === 404 && bei404) throw new SyncFehler('server', bei404);
  if ([404, 502, 503, 504].includes(antwort.status)) {
    throw new SyncFehler('server', 'Unter dieser Adresse ist kein Truhenblick-Sync-Backend erreichbar.');
  }
  if (!antwort.ok) {
    // Der Server begründet Absagen (z. B. „Höchstzahl an Truhen erreicht“) selbst.
    throw new SyncFehler('server', (await serverMeldung(antwort)) ?? `Der Server meldet einen Fehler (${antwort.status}).`);
  }

  try {
    const daten: unknown = await antwort.json();
    if (typeof daten === 'object' && daten !== null) return daten as Record<string, unknown>;
  } catch {
    // unten gemeldet
  }
  throw new SyncFehler('server', KEIN_SERVER);
}

/** Liest eine Absage des Servers: { fehler: "…", art?: "anmeldung" }. */
async function absageVon(antwort: Response): Promise<{ fehler: string | null; art: string | null }> {
  try {
    const daten = (await antwort.json()) as { fehler?: unknown; art?: unknown };
    return {
      fehler: typeof daten.fehler === 'string' && daten.fehler ? daten.fehler : null,
      art: typeof daten.art === 'string' ? daten.art : null,
    };
  } catch {
    return { fehler: null, art: null };
  }
}

async function serverMeldung(antwort: Response): Promise<string | null> {
  return (await absageVon(antwort)).fehler;
}

// ---------------------------------------------------------------- Truhen anlegen

export interface ServerInfo {
  /** Unter der Adresse antwortet ein Truhenblick-Server */
  da: boolean;
  /** Er nimmt neue Truhen an */
  neueTruhen: boolean;
  /** Er verlangt ein Passwort */
  anmeldung: boolean;
  /** Dieses Gerät ist angemeldet – ohne Passwort auf dem Server immer true */
  angemeldet: boolean;
  erreichbarkeit: Erreichbarkeit;
  /** Der in der App eingestellte Rechnername (z. B. „truhe.example.de“), falls es einen gibt */
  adresse: string | null;
  /** Kennung des Servers – zum Vergleich, ob unter einer anderen Adresse derselbe antwortet */
  kennung: string | null;
}

export const NICHT_DA: ServerInfo = {
  da: false,
  neueTruhen: false,
  anmeldung: false,
  angemeldet: true,
  erreichbarkeit: 'heimnetz',
  adresse: null,
  kennung: null,
};

/**
 * Gibt es unter der Adresse einen Truhenblick-Server – und lässt sich dort eine Truhe anlegen?
 * Leere Adresse = der Server, von dem die App geladen wurde. Wirft nie.
 */
export async function pruefeServer(url: string): Promise<ServerInfo> {
  try {
    const sitzung = await sitzungFuer(url);
    const antwort = await fetch(`${url}/api/health`, {
      headers: sitzung ? { 'X-Truhenblick-Sitzung': sitzung } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!antwort.ok) return NICHT_DA;
    return leseServerInfo(await antwort.json());
  } catch {
    return NICHT_DA;
  }
}

/** Prüft die Antwort von GET /api/health. Ältere Server kennen die meisten Angaben noch nicht. */
export function leseServerInfo(roh: unknown): ServerInfo {
  if (typeof roh !== 'object' || roh === null) return NICHT_DA;
  const daten = roh as Record<string, unknown>;
  if (daten.app !== 'truhenblick') return NICHT_DA;
  const anmeldung = daten.anmeldung === true;
  return {
    da: true,
    neueTruhen: daten.neueTruhen === true,
    anmeldung,
    angemeldet: anmeldung ? daten.angemeldet === true : true,
    erreichbarkeit: daten.erreichbarkeit === 'proxy' || daten.erreichbarkeit === 'selbst' ? daten.erreichbarkeit : 'heimnetz',
    adresse: typeof daten.adresse === 'string' && daten.adresse ? daten.adresse : null,
    kennung: typeof daten.kennung === 'string' && daten.kennung ? daten.kennung : null,
  };
}

/** Legt auf dem Server eine neue, leere Truhe an und liefert ihren Zugangscode. */
export async function legeTruheAn(url: string): Promise<string> {
  const daten = await rufe(
    { url, token: '' },
    '/api/truhen',
    {},
    'Dieser Server kann noch keine Truhen anlegen. Bitte zuerst den Server aktualisieren (truhenblick-update).',
  );
  if (typeof daten.code !== 'string' || daten.code.length < 16) throw new SyncFehler('server', KEIN_SERVER);
  return daten.code;
}

/** Schickt eine Sync-Anfrage an den Server. */
export const sendeAnfrage: Sende = async (konfig, anfrage) => {
  const daten = await rufe(konfig, '/api/sync', anfrage);
  if (
    typeof daten.serverId !== 'string' ||
    typeof daten.rev !== 'number' ||
    !Array.isArray(daten.bereiche) ||
    !Array.isArray(daten.artikel)
  ) {
    throw new SyncFehler('server', KEIN_SERVER);
  }
  return daten as unknown as SyncAntwort;
};

export type FordereCode = (konfig: SyncKonfig) => Promise<string>;

/** Lässt den Server einen neuen Zugangscode erzeugen; der bisherige gilt danach nicht mehr. */
export const fordereNeuenCode: FordereCode = async (konfig) => {
  const daten = await rufe(
    konfig,
    '/api/code',
    {},
    'Dieser Server kann noch keine Codes erzeugen. Bitte zuerst den Server aktualisieren (truhenblick-update).',
  );
  if (typeof daten.code !== 'string' || daten.code.length < 16) throw new SyncFehler('server', KEIN_SERVER);
  return daten.code;
};

/** Der auf diesem Gerät hinterlegte Zugangscode (zum Anzeigen für weitere Geräte). */
export async function gespeicherterCode(): Promise<string | null> {
  return (await ladeKonfig())?.token ?? null;
}

/**
 * Erzeugt einen neuen Zugangscode und hinterlegt ihn auf diesem Gerät.
 * Der Abgleichsstand bleibt erhalten – es ändert sich nur der Code.
 */
export async function erneuereCode(fordere: FordereCode = fordereNeuenCode): Promise<string> {
  const konfig = await ladeKonfig();
  if (!konfig) throw new SyncFehler('server', 'Dieses Gerät ist mit keinem Server verbunden.');
  const code = await fordere(konfig);
  await metaSchreiben(KONFIG, { ...konfig, token: code });
  return code;
}

/**
 * Hinterlegt einen anderen Zugangscode (wenn auf einem anderen Gerät ein neuer erzeugt wurde)
 * und gleicht damit ab. Stimmt er nicht, bleibt der bisherige gespeichert.
 */
export async function wechsleCode(code: string, sende: Sende = sendeAnfrage): Promise<void> {
  const konfig = await ladeKonfig();
  if (!konfig) throw new SyncFehler('server', 'Dieses Gerät ist mit keinem Server verbunden.');
  await metaSchreiben(KONFIG, { ...konfig, token: code.trim() });
  try {
    await synchronisiere(sende);
  } catch (fehler) {
    if (fehler instanceof SyncFehler && fehler.art === 'token') await metaSchreiben(KONFIG, konfig);
    throw fehler;
  }
}

// ---------------------------------------------------------------- Lese-Schlüssel (Home Assistant)

/** Der Lese-Schlüssel bleibt auf dem Gerät, das ihn erzeugt hat – der Server kennt nur seine Prüfsumme. */
const LESE_SCHLUESSEL = 'sync.leseSchluessel';
const SERVER_OHNE_UEBERSICHT =
  'Dieser Server kennt die Übersicht für Home Assistant noch nicht. Bitte zuerst den Server aktualisieren.';

async function verbunden(): Promise<SyncKonfig> {
  const konfig = await ladeKonfig();
  if (!konfig) throw new SyncFehler('server', 'Dieses Gerät ist mit keinem Server verbunden.');
  return konfig;
}

/** Der auf diesem Gerät erzeugte Lese-Schlüssel, falls vorhanden. */
export async function leseSchluesselLokal(): Promise<string | null> {
  return (await metaLesen<string>(LESE_SCHLUESSEL)) ?? null;
}

/** Gibt es für diese Truhe einen Lese-Schlüssel (auch wenn ein anderes Gerät ihn erzeugt hat)? */
export async function leseZugangAktiv(): Promise<boolean> {
  const daten = await rufe(await verbunden(), '/api/lesezugang', undefined, SERVER_OHNE_UEBERSICHT);
  return daten.aktiv === true;
}

/**
 * Erzeugt einen Lese-Schlüssel: Er öffnet nur die Übersicht der Truhe, nichts lässt sich damit ändern.
 * Ein bisheriger Schlüssel wird dadurch ungültig.
 */
export async function erzeugeLeseSchluessel(): Promise<string> {
  const daten = await rufe(await verbunden(), '/api/lesezugang', {}, SERVER_OHNE_UEBERSICHT);
  if (typeof daten.schluessel !== 'string' || daten.schluessel.length < 16) throw new SyncFehler('server', KEIN_SERVER);
  await metaSchreiben(LESE_SCHLUESSEL, daten.schluessel);
  return daten.schluessel;
}

/** Widerruft den Lese-Schlüssel – Home Assistant bekommt danach keine Daten mehr. */
export async function widerrufeLeseSchluessel(): Promise<void> {
  await rufe(await verbunden(), '/api/lesezugang', undefined, SERVER_OHNE_UEBERSICHT, 'DELETE');
  await db.meta.delete(LESE_SCHLUESSEL);
}

// ---------------------------------------------------------------- Anmeldung mit Passwort

/** Der Server, mit dem dieses Gerät spricht: der verbundene – sonst der, von dem die App geladen wurde. */
export async function serverUrl(): Promise<string> {
  return (await ladeKonfig())?.url ?? '';
}

const SERVER_OHNE_ANMELDUNG = 'Dieser Server kennt das noch nicht. Bitte zuerst den Server aktualisieren.';

function leseSitzung(daten: Record<string, unknown>): string {
  if (typeof daten.sitzung !== 'string' || daten.sitzung.length < 16) throw new SyncFehler('server', KEIN_SERVER);
  return daten.sitzung;
}

/** Meldet dieses Gerät mit dem Passwort des Servers an. Bei falschem Passwort: SyncFehler der Art „token“. */
export async function meldeAn(passwort: string): Promise<void> {
  const url = await serverUrl();
  const daten = await rufe({ url, token: '' }, '/api/anmelden', { passwort }, SERVER_OHNE_ANMELDUNG, undefined, 'Das Passwort stimmt nicht.');
  await metaSchreiben(SITZUNG, { url, wert: leseSitzung(daten) } satisfies Sitzung);
}

/** Meldet dieses Gerät ab. Die Daten auf dem Gerät bleiben, wie sie sind. */
export async function meldeAb(): Promise<void> {
  const url = await serverUrl();
  try {
    await rufe({ url, token: '' }, '/api/abmelden', {});
  } catch {
    // Auch wenn der Server gerade nicht antwortet: Dieses Gerät vergisst seine Anmeldung.
  }
  await db.meta.delete(SITZUNG);
}

// ---------------------------------------------------------------- Einstellungen des Servers

function leseServerEinstellungen(daten: Record<string, unknown>): ServerEinstellungen {
  const anfrage = daten.anfrage as { host?: unknown; https?: unknown; ueberProxy?: unknown } | undefined;
  if (typeof daten.betreiber !== 'boolean' || typeof anfrage !== 'object' || anfrage === null) throw new SyncFehler('server', KEIN_SERVER);
  return {
    betreiber: daten.betreiber,
    erreichbarkeit: daten.erreichbarkeit === 'proxy' || daten.erreichbarkeit === 'selbst' ? daten.erreichbarkeit : 'heimnetz',
    adresse: typeof daten.adresse === 'string' ? daten.adresse : '',
    anmeldung: daten.anmeldung === true,
    sitzungen: typeof daten.sitzungen === 'number' ? daten.sitzungen : 0,
    anfrage: {
      host: typeof anfrage.host === 'string' ? anfrage.host : '',
      https: anfrage.https === true,
      ueberProxy: anfrage.ueberProxy === true,
    },
  };
}

/** Adresse, Erreichbarkeit und Anmeldung des Servers – ändern dürfen sie nur Geräte der zuerst angelegten Truhe. */
export async function holeServerEinstellungen(): Promise<ServerEinstellungen> {
  return leseServerEinstellungen(await rufe(await verbunden(), '/api/server', undefined, SERVER_OHNE_ANMELDUNG));
}

export async function speichereServerEinstellungen(erreichbarkeit: Erreichbarkeit, adresse: string): Promise<ServerEinstellungen> {
  return leseServerEinstellungen(await rufe(await verbunden(), '/api/server', { erreichbarkeit, adresse }, SERVER_OHNE_ANMELDUNG));
}

/**
 * Legt das Passwort fest oder ändert es; `null` schaltet die Anmeldung ab.
 * Alle anderen Geräte müssen sich danach neu anmelden – dieses bleibt angemeldet.
 */
export async function setzePasswort(passwort: string | null): Promise<void> {
  const konfig = await verbunden();
  const daten = await rufe(konfig, '/api/passwort', { passwort }, SERVER_OHNE_ANMELDUNG);
  if (passwort === null) await db.meta.delete(SITZUNG);
  else await metaSchreiben(SITZUNG, { url: konfig.url, wert: leseSitzung(daten) } satisfies Sitzung);
}

/** Meldet alle anderen Geräte ab. */
export async function meldeAndereAb(): Promise<void> {
  await rufe(await verbunden(), '/api/sitzungen', undefined, SERVER_OHNE_ANMELDUNG, 'DELETE');
}

export type AdressPruefung = 'ok' | 'anderer-server' | 'nicht-erreichbar';

/**
 * Antwortet unter https://<adresse> wirklich dieser Server? Vergleicht die Kennung aus der Auskunft,
 * die jeder Truhenblick-Server ohne Anmeldung gibt.
 */
export async function pruefeAdresse(adresse: string, kennung: string | null): Promise<AdressPruefung> {
  try {
    const antwort = await fetch(`https://${adresse}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!antwort.ok) return 'nicht-erreichbar';
    const info = leseServerInfo(await antwort.json());
    if (!info.da) return 'anderer-server';
    return kennung !== null && info.kennung === kennung ? 'ok' : 'anderer-server';
  } catch {
    return 'nicht-erreichbar';
  }
}

// ---------------------------------------------------------------- Aktualisierung des Servers

const SERVER_ZU_ALT =
  'Dieser Server kann sich noch nicht aus der App aktualisieren. Bitte einmal von Hand aktualisieren (truhenblick-update).';

/** Prüft die Antwort von GET /api/update. */
export function leseUpdateStand(daten: Record<string, unknown>): UpdateStand {
  if (typeof daten.moeglich !== 'boolean' || typeof daten.laeuft !== 'boolean') throw new SyncFehler('server', KEIN_SERVER);
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  const l = daten.letztes as { zustand?: unknown; beendet?: unknown; meldung?: unknown } | null | undefined;
  return {
    moeglich: daten.moeglich,
    grund: daten.grund === 'andere-truhe' || daten.grund === 'nicht-eingerichtet' ? daten.grund : null,
    installiert: text(daten.installiert),
    verfuegbar: text(daten.verfuegbar),
    neu: typeof daten.neu === 'boolean' ? daten.neu : null,
    geprueft: text(daten.geprueft),
    laeuft: daten.laeuft,
    letztes:
      l && (l.zustand === 'fertig' || l.zustand === 'fehler') && typeof l.beendet === 'string' && typeof l.meldung === 'string'
        ? { zustand: l.zustand, beendet: l.beendet, meldung: l.meldung }
        : null,
    protokoll: text(daten.protokoll),
  };
}

/**
 * Stand der Server-Aktualisierung. `pruefen` lässt den Server sofort bei der Quelle nachsehen.
 * Liefert null, wenn dieses Gerät mit keinem Server verbunden ist.
 */
export async function holeUpdateStand(pruefen = false): Promise<UpdateStand | null> {
  const konfig = await ladeKonfig();
  if (!konfig) return null;
  return leseUpdateStand(await rufe(konfig, `/api/update${pruefen ? '?pruefen=1' : ''}`, undefined, SERVER_ZU_ALT));
}

/** Stößt das Update des Servers an. Ausgeführt wird es dort von einem eigenen Dienst. */
export async function starteServerUpdate(): Promise<void> {
  const konfig = await ladeKonfig();
  if (!konfig) throw new SyncFehler('server', 'Dieses Gerät ist mit keinem Server verbunden.');
  await rufe(konfig, '/api/update', {}, SERVER_ZU_ALT);
}

interface Tabelle<T extends SyncDoc> {
  get(id: string): Promise<(T & Lokal) | undefined>;
  put(doc: T & Lokal): Promise<unknown>;
  update(id: string, aenderung: { dirty: 0 }): Promise<unknown>;
}

/**
 * Verarbeitet die Antwort für eine Tabelle:
 * 1. Gesendetes gilt als übertragen – außer es wurde währenddessen erneut geändert.
 * 2. Empfangenes ersetzt die lokale Fassung, wenn es die jüngere Änderung ist.
 */
async function uebernehme<T extends SyncDoc>(tabelle: Tabelle<T>, gesendet: T[], empfangen: T[]): Promise<number> {
  for (const g of gesendet) {
    const aktuell = await tabelle.get(g.id);
    if (aktuell && aktuell.geaendertAm === g.geaendertAm) await tabelle.update(g.id, { dirty: 0 });
  }
  let uebernommen = 0;
  for (const fern of empfangen) {
    const lokal = await tabelle.get(fern.id);
    if (!eingehendeGewinnt(lokal ? (ohneLokal(lokal) as unknown as T) : undefined, fern)) continue;
    await tabelle.put({ ...fern, dirty: 0 });
    uebernommen += 1;
  }
  return uebernommen;
}

export interface SyncErgebnis {
  gesendet: number;
  empfangen: number;
}

/**
 * Ein vollständiger Abgleich: lokale Änderungen hochladen, fremde abholen.
 * Wirft einen SyncFehler, wenn der Server nicht erreichbar ist oder ablehnt –
 * die lokalen Änderungen bleiben dann vorgemerkt.
 */
export async function synchronisiere(sende: Sende = sendeAnfrage, wiederholt = false): Promise<SyncErgebnis | null> {
  const konfig = await ladeKonfig();
  if (!konfig) return null;

  const [bereiche, artikel, seit, bekannterServer] = await Promise.all([
    db.bereiche.where('dirty').equals(1).toArray(),
    db.artikel.where('dirty').equals(1).toArray(),
    metaLesen<number>(REV),
    metaLesen<string>(SERVER_ID),
  ]);
  const gesendetB = bereiche.map((b) => bereinigeBereich(b));
  const gesendetA = artikel.map((a) => bereinigeArtikel(a));

  const antwort = await sende(konfig, { seit: seit ?? 0, bereiche: gesendetB, artikel: gesendetA });

  // Anderer oder zurückgesetzter Server: Er kennt unsere Daten nicht (mehr) – alles erneut abgleichen.
  const serverGewechselt = bekannterServer !== undefined && bekannterServer !== antwort.serverId;
  const serverZurueckgesetzt = antwort.rev < (seit ?? 0);
  if ((serverGewechselt || serverZurueckgesetzt) && !wiederholt) {
    await db.transaction('rw', db.meta, db.bereiche, db.artikel, async () => {
      await metaSchreiben(SERVER_ID, antwort.serverId);
      await metaSchreiben(REV, 0);
      await allesVormerken();
    });
    return synchronisiere(sende, true);
  }

  const empfangenB = antwort.bereiche.filter(istBereich).map(bereinigeBereich);
  const empfangenA = antwort.artikel.filter(istArtikel).map(bereinigeArtikel);

  const empfangen = await db.transaction('rw', db.meta, db.bereiche, db.artikel, async () => {
    const b = await uebernehme<Bereich>(db.bereiche, gesendetB, empfangenB);
    const a = await uebernehme<Artikel>(db.artikel, gesendetA, empfangenA);
    await metaSchreiben(REV, antwort.rev);
    await metaSchreiben(SERVER_ID, antwort.serverId);
    await metaSchreiben(LETZTER_ERFOLG, new Date().toISOString());
    return a + b;
  });

  return { gesendet: gesendetB.length + gesendetA.length, empfangen };
}
