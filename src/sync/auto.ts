import { useSyncExternalStore } from 'react';
import { beiAenderung } from '../db/repo.ts';
import {
  entferneKonfig,
  erneuereCode,
  ladeKonfig,
  letzterErfolg,
  normalisiereUrl,
  speichereKonfig,
  SyncFehler,
  synchronisiere,
  wechsleCode,
  type SyncKonfig,
} from './client.ts';

export interface SyncStatus {
  /** aus = nicht eingerichtet */
  zustand: 'aus' | 'bereit' | 'laeuft' | 'fehler';
  url: string;
  letzterErfolg: string | null;
  fehler: string | null;
  /** Bei „token“ gilt der hinterlegte Zugangscode nicht mehr – das Gerät braucht den neuen. */
  fehlerArt: SyncFehler['art'] | null;
}

const NACH_AENDERUNG_MS = 1500;
const REGELMAESSIG_MS = 60_000;

let status: SyncStatus = { zustand: 'aus', url: '', letzterErfolg: null, fehler: null, fehlerArt: null };
const lauscher = new Set<() => void>();

function setze(teil: Partial<SyncStatus>): void {
  status = { ...status, ...teil };
  for (const fn of lauscher) fn();
}

function meldeFehler(fehler: unknown): void {
  const bekannt = fehler instanceof SyncFehler;
  const text = bekannt ? fehler.message : 'Der Abgleich ist fehlgeschlagen.';
  setze({
    zustand: 'fehler',
    fehler: navigator.onLine ? text : 'Keine Internetverbindung – der Abgleich folgt automatisch.',
    fehlerArt: bekannt ? fehler.art : 'server',
  });
}

let laeuft: Promise<void> | null = null;
let nochmal = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Gleicht jetzt ab. Läuft schon ein Abgleich, folgt direkt danach ein weiterer. */
export function gleicheAb(): Promise<void> {
  if (laeuft) {
    nochmal = true;
    return laeuft;
  }
  laeuft = (async () => {
    try {
      do {
        nochmal = false;
        if (!(await ladeKonfig())) {
          setze({ zustand: 'aus', url: '', fehler: null, fehlerArt: null, letzterErfolg: null });
          return;
        }
        setze({ zustand: 'laeuft' });
        await synchronisiere();
        setze({ zustand: 'bereit', fehler: null, fehlerArt: null, letzterErfolg: await letzterErfolg() });
      } while (nochmal);
    } catch (fehler) {
      meldeFehler(fehler);
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

function bald(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void gleicheAb(), NACH_AENDERUNG_MS);
}

/**
 * Richtet den automatischen Abgleich ein: beim Start, nach jeder Änderung,
 * wenn das Gerät wieder online ist oder die App in den Vordergrund kommt,
 * und regelmäßig, solange sie sichtbar ist. Ohne eingerichteten Server passiert nichts.
 */
export function starteAutoSync(): () => void {
  const sichtbar = () => {
    if (document.visibilityState === 'visible') void gleicheAb();
  };
  const abmelden = beiAenderung(bald);
  window.addEventListener('online', gleicheAb);
  document.addEventListener('visibilitychange', sichtbar);
  const intervall = setInterval(sichtbar, REGELMAESSIG_MS);

  void (async () => {
    const konfig = await ladeKonfig();
    if (!konfig) return;
    setze({ zustand: 'bereit', url: konfig.url, letzterErfolg: await letzterErfolg() });
    void gleicheAb();
  })();

  return () => {
    abmelden();
    clearTimeout(timer);
    clearInterval(intervall);
    window.removeEventListener('online', gleicheAb);
    document.removeEventListener('visibilitychange', sichtbar);
  };
}

/**
 * Verbindet mit einem Server: Erst wenn ein Abgleich gelingt, wird die Verbindung
 * behalten – sonst wird sie verworfen und der Fehler gemeldet.
 */
export async function verbinde(eingabe: SyncKonfig): Promise<void> {
  const vorher = await ladeKonfig();
  const konfig = { url: normalisiereUrl(eingabe.url), token: eingabe.token.trim() };
  await speichereKonfig(konfig);
  setze({ zustand: 'laeuft', url: konfig.url, fehler: null, fehlerArt: null });
  try {
    await synchronisiere();
    setze({ zustand: 'bereit', letzterErfolg: await letzterErfolg() });
  } catch (fehler) {
    if (vorher) await speichereKonfig(vorher);
    else await entferneKonfig();
    setze(vorher ? { zustand: 'bereit', url: vorher.url } : { zustand: 'aus', url: '' });
    throw fehler;
  }
}

export async function trenne(): Promise<void> {
  await entferneKonfig();
  setze({ zustand: 'aus', url: '', fehler: null, fehlerArt: null, letzterErfolg: null });
}

/** Wartet einen laufenden Abgleich ab, damit sich zwei nicht in die Quere kommen. */
async function ruhe(): Promise<void> {
  if (laeuft) await laeuft.catch(() => undefined);
}

/**
 * Erzeugt einen neuen Zugangscode und liefert ihn. Der bisherige gilt sofort nicht mehr –
 * alle anderen Geräte brauchen danach den neuen.
 */
export async function neuerCode(): Promise<string> {
  await ruhe();
  const code = await erneuereCode();
  void gleicheAb();
  return code;
}

/** Hinterlegt den Code, der auf einem anderen Gerät neu erzeugt wurde. Wirft, wenn er nicht stimmt. */
export async function setzeCode(code: string): Promise<void> {
  await ruhe();
  setze({ zustand: 'laeuft' });
  try {
    await wechsleCode(code);
    setze({ zustand: 'bereit', fehler: null, fehlerArt: null, letzterErfolg: await letzterErfolg() });
  } catch (fehler) {
    meldeFehler(fehler);
    throw fehler;
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      lauscher.add(fn);
      return () => lauscher.delete(fn);
    },
    () => status,
  );
}
