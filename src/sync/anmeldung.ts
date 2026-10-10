import { useSyncExternalStore } from 'react';
import { gleicheAb } from './auto.ts';
import { horcheAufFehlendeAnmeldung, meldeAb, meldeAn, pruefeServer, serverUrl, type ServerInfo } from './client.ts';

export interface AnmeldeStatus {
  /**
   * - unbekannt:  noch nicht geprüft, oder der Server antwortet gerade nicht (z. B. offline)
   * - offen:      der Server verlangt kein Passwort
   * - noetig:     er verlangt eines, und dieses Gerät ist nicht angemeldet
   * - angemeldet: er verlangt eines, und dieses Gerät ist angemeldet
   */
  stand: 'unbekannt' | 'offen' | 'noetig' | 'angemeldet';
  /** Die erste Prüfung ist abgeschlossen – auch wenn der Server dabei nicht geantwortet hat. */
  geprueft: boolean;
  /** Letzte Auskunft des Servers */
  server: ServerInfo | null;
}

let status: AnmeldeStatus = { stand: 'unbekannt', geprueft: false, server: null };
const lauscher = new Set<() => void>();

function setze(teil: Partial<AnmeldeStatus>): void {
  status = { ...status, ...teil };
  for (const fn of lauscher) fn();
}

/**
 * Soll die Seite auf https:// wechseln? Ja, wenn Truhenblick für genau diesen Namen selbst ein
 * Zertifikat holt und die App von dort über http:// geladen wurde.
 */
export function httpsZiel(info: ServerInfo, ort: Pick<Location, 'protocol' | 'hostname' | 'pathname' | 'search' | 'hash'>): string | null {
  if (info.erreichbarkeit !== 'selbst' || !info.adresse) return null;
  if (ort.protocol !== 'http:' || ort.hostname.toLowerCase() !== info.adresse) return null;
  return `https://${info.adresse}${ort.pathname}${ort.search}${ort.hash}`;
}

let laeuft: Promise<void> | null = null;

/** Fragt den Server, ob er eine Anmeldung verlangt und ob dieses Gerät angemeldet ist. */
export function pruefeAnmeldung(): Promise<void> {
  laeuft ??= (async () => {
    try {
      const url = await serverUrl();
      const info = await pruefeServer(url);
      if (!info.da) {
        // Ohne Antwort bleibt die App benutzbar – die Daten liegen auf dem Gerät.
        setze({ stand: 'unbekannt', geprueft: true });
        return;
      }
      const ziel = url === '' ? httpsZiel(info, window.location) : null;
      if (ziel) {
        window.location.replace(ziel);
        return;
      }
      setze({ stand: !info.anmeldung ? 'offen' : info.angemeldet ? 'angemeldet' : 'noetig', geprueft: true, server: info });
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

/** Meldet dieses Gerät an und gleicht danach ab. Wirft einen SyncFehler, wenn das Passwort nicht stimmt. */
export async function anmelden(passwort: string): Promise<void> {
  await meldeAn(passwort);
  setze({ stand: 'angemeldet', geprueft: true });
  void gleicheAb();
  void pruefeAnmeldung();
}

export async function abmelden(): Promise<void> {
  await meldeAb();
  await pruefeAnmeldung();
}

/**
 * Prüft beim Start und immer dann, wenn sich etwas geändert haben kann: wenn das Gerät wieder
 * online ist, die App in den Vordergrund kommt oder der Server eine Anfrage wegen fehlender
 * Anmeldung abgewiesen hat.
 */
export function starteAnmeldung(): () => void {
  const sichtbar = () => {
    if (document.visibilityState === 'visible') void pruefeAnmeldung();
  };
  const online = () => void pruefeAnmeldung();
  // Nachfragen statt annehmen: Die Absage kann auch von einem anderen Server stammen, dem dieses
  // Gerät gerade beitreten wollte.
  horcheAufFehlendeAnmeldung(() => void pruefeAnmeldung());
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', sichtbar);
  void pruefeAnmeldung();

  return () => {
    horcheAufFehlendeAnmeldung(null);
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', sichtbar);
  };
}

export function useAnmeldung(): AnmeldeStatus {
  return useSyncExternalStore(
    (fn) => {
      lauscher.add(fn);
      return () => lauscher.delete(fn);
    },
    () => status,
  );
}
