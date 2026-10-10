import { eingehendeGewinnt } from '../../shared/sync.ts';
import type { Artikel, Bereich, SyncAnfrage, SyncAntwort, SyncDoc } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import { db, metaLesen, metaSchreiben, ohneLokal, type Lokal } from '../db/db.ts';

export interface SyncKonfig {
  /** Adresse des Servers ohne /api; leer = dieselbe Adresse, von der die App geladen wurde */
  url: string;
  token: string;
}

export class SyncFehler extends Error {
  art: 'token' | 'netz' | 'server' | 'gesperrt';

  constructor(art: SyncFehler['art'], meldung: string) {
    super(meldung);
    this.art = art;
  }
}

const KONFIG = 'sync.konfig';
const REV = 'sync.rev';
const SERVER_ID = 'sync.serverId';
const LETZTER_ERFOLG = 'sync.letzterErfolg';

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
    await db.meta.bulkDelete([KONFIG, REV, SERVER_ID, LETZTER_ERFOLG]);
    await allesVormerken();
  });
}

async function allesVormerken(): Promise<void> {
  await db.bereiche.toCollection().modify({ dirty: 1 });
  await db.artikel.toCollection().modify({ dirty: 1 });
}

export type Sende = (konfig: SyncKonfig, anfrage: SyncAnfrage) => Promise<SyncAntwort>;

const KEIN_SERVER = 'Unter dieser Adresse antwortet kein Truhenblick-Server.';

/** POST an das Backend; übersetzt Fehler in verständliche Meldungen. `bei404` ersetzt die Meldung für „unbekannt“. */
async function post(konfig: SyncKonfig, pfad: string, koerper: unknown, bei404?: string): Promise<Record<string, unknown>> {
  let antwort: Response;
  try {
    antwort = await fetch(`${konfig.url}${pfad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${konfig.token}` },
      body: JSON.stringify(koerper),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SyncFehler('netz', 'Der Server ist nicht erreichbar.');
  }
  if (antwort.status === 401) throw new SyncFehler('token', 'Der Zugangscode stimmt nicht.');
  if (antwort.status === 429) throw new SyncFehler('gesperrt', 'Zu viele Fehlversuche – bitte in einigen Minuten erneut versuchen.');
  if (antwort.status === 404 && bei404) throw new SyncFehler('server', bei404);
  if ([404, 502, 503, 504].includes(antwort.status)) {
    throw new SyncFehler('server', 'Unter dieser Adresse ist kein Truhenblick-Sync-Backend erreichbar.');
  }
  if (!antwort.ok) throw new SyncFehler('server', `Der Server meldet einen Fehler (${antwort.status}).`);

  try {
    const daten: unknown = await antwort.json();
    if (typeof daten === 'object' && daten !== null) return daten as Record<string, unknown>;
  } catch {
    // unten gemeldet
  }
  throw new SyncFehler('server', KEIN_SERVER);
}

/** Schickt eine Sync-Anfrage an den Server. */
export const sendeAnfrage: Sende = async (konfig, anfrage) => {
  const daten = await post(konfig, '/api/sync', anfrage);
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
  const daten = await post(
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
