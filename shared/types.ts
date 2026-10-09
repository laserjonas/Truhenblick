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
  /** Kategorie-ID aus src/config/kategorien.ts */
  kategorie: string;
  emoji: string;
  menge: number;
  /** Einheiten-ID aus src/config/einheiten.ts */
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
