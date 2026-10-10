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
