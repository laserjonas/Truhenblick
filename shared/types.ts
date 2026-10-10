/** Gemeinsame Typen für Frontend und Sync-Backend. */

export interface SyncDoc {
  id: string;
  /** ISO-Zeitstempel (UTC) der letzten Änderung – Grundlage für „letzte Änderung gewinnt“. */
  geaendertAm: string;
  /** Gesetzt, wenn der Datensatz gelöscht wurde (bleibt als Markierung erhalten), sonst null. */
  geloeschtAm: string | null;
}

export type BereichTyp = 'korb' | 'ebene' | 'fach';

export interface Bereich extends SyncDoc {
  name: string;
  typ: BereichTyp;
  /** Position innerhalb der Geschwister, aufsteigend. */
  reihenfolge: number;
  /** Bei Fächern die Ebene, in der sie liegen. */
  parentId: string | null;
}

export interface Artikel extends SyncDoc {
  name: string;
  /** Kategorie-ID aus shared/config/kategorien.ts */
  kategorie: string;
  emoji: string;
  menge: number;
  /** Einheiten-ID aus shared/config/einheiten.ts */
  einheit: string;
  /** Datum im Format JJJJ-MM-TT */
  eingefrorenAm: string;
  /** Datum im Format JJJJ-MM-TT; null = Standardhaltbarkeit der Kategorie */
  haltbarBis: string | null;
  bereichId: string;
  notiz: string;
  erstelltAm: string;
}

export interface SyncAnfrage {
  /** Letzter Serverstand, den dieses Gerät kennt (0 = alles holen). */
  seit: number;
  bereiche: Bereich[];
  artikel: Artikel[];
}

export interface SyncAntwort {
  /** Kennung der Serverdatenbank – ändert sie sich, wurde der Server neu aufgesetzt. */
  serverId: string;
  rev: number;
  bereiche: Bereich[];
  artikel: Artikel[];
}

/** Stand der Server-Aktualisierung, wie ihn GET /api/update liefert. */
export interface UpdateStand {
  /** Lässt sich dieser Server aus der App aktualisieren? (Nicht bei Docker.) */
  moeglich: boolean;
  /**
   * Warum nicht: Die Einrichtung dafür fehlt (z. B. Docker) – oder diese Truhe ist nicht die
   * zuerst angelegte; nur deren Geräte dürfen den Server aktualisieren.
   */
  grund?: 'nicht-eingerichtet' | 'andere-truhe' | null;
  /** Installierter Stand (Git-Commit) oder null, wenn unbekannt */
  installiert: string | null;
  /** Neuester Stand der Quelle oder null, wenn sie nicht erreichbar war */
  verfuegbar: string | null;
  /** Gibt es etwas Neues? null = konnte nicht geprüft werden */
  neu: boolean | null;
  /** Zeitpunkt der letzten Prüfung der Quelle */
  geprueft: string | null;
  /** Ein Update läuft gerade */
  laeuft: boolean;
  /** Ergebnis des letzten aus der App angestoßenen Updates */
  letztes: { zustand: 'fertig' | 'fehler'; beendet: string; meldung: string } | null;
  /** Letzte Zeilen des Protokolls – nur nach einem Fehler */
  protokoll: string | null;
}

/**
 * Wie der Server erreichbar ist:
 * - heimnetz: nur über http:// im eigenen Netz
 * - proxy:    ein Reverse Proxy davor (z. B. Nginx Proxy Manager) kümmert sich um HTTPS
 * - selbst:   Truhenblick holt für die Adresse selbst ein HTTPS-Zertifikat
 */
export type Erreichbarkeit = 'heimnetz' | 'proxy' | 'selbst';

/** Antwort von GET /api/health – ohne Anmeldung abrufbar. */
export interface ServerAuskunft {
  ok: true;
  app: 'truhenblick';
  version: string;
  /** Lassen sich hier neue Truhen anlegen? */
  neueTruhen: boolean;
  /** Verlangt der Server ein Passwort? */
  anmeldung: boolean;
  /** Ist diese Anfrage angemeldet? (Ohne Passwort auf dem Server immer true.) */
  angemeldet: boolean;
  erreichbarkeit: Erreichbarkeit;
  /** Der eingestellte Rechnername, z. B. „truhe.example.de“ – null bei „heimnetz“ */
  adresse: string | null;
  /** Zufällige Kennung dieses Servers – zum Prüfen, ob unter einer Adresse derselbe antwortet */
  kennung: string;
}

/** Antwort von GET /api/server: Einstellungen des Servers, nur für den Betreiber. */
export interface ServerEinstellungen {
  /** Gehört dieses Gerät zur zuerst angelegten Truhe? Nur dann lassen sich die Einstellungen ändern. */
  betreiber: boolean;
  erreichbarkeit: Erreichbarkeit;
  /** Rechnername ohne https:// – leer, solange keiner eingetragen ist */
  adresse: string;
  /** Ist ein Passwort gesetzt? */
  anmeldung: boolean;
  /** Auf so vielen Geräten ist gerade jemand angemeldet */
  sitzungen: number;
  /** So kam diese Anfrage beim Server an – hilft beim Einrichten eines Reverse Proxys */
  anfrage: {
    /** Name, unter dem der Server angesprochen wurde */
    host: string;
    /** Kam sie beim Gerät über https:// an? */
    https: boolean;
    /** Hat ein vorgeschalteter Proxy sie weitergereicht? */
    ueberProxy: boolean;
  };
}
