import { eingehendeGewinnt, zeitstempelNach } from '../../shared/sync.ts';
import type { Artikel, Bereich, SyncDoc } from '../../shared/types.ts';
import { bereinigeArtikel, bereinigeBereich, istArtikel, istBereich } from '../../shared/validierung.ts';
import { db, ohneLokal, type Lokal } from './db.ts';
import { meldeAenderung } from './repo.ts';

export interface Backup {
  app: 'truhenblick';
  version: 1;
  exportiertAm: string;
  bereiche: Bereich[];
  artikel: Artikel[];
}

/** Alle Daten samt Löschmarkierungen – so lässt sich ein Backup auch mit einem anderen Gerät zusammenführen. */
export async function erstelleBackup(): Promise<Backup> {
  const [bereiche, artikel] = await Promise.all([db.bereiche.toArray(), db.artikel.toArray()]);
  return {
    app: 'truhenblick',
    version: 1,
    exportiertAm: new Date().toISOString(),
    bereiche: bereiche.map((b) => bereinigeBereich(ohneLokal(b) as Bereich)),
    artikel: artikel.map((a) => bereinigeArtikel(ohneLokal(a) as Artikel)),
  };
}

export class BackupFehler extends Error {}

/** Prüft eingelesene JSON-Daten und liefert ein sauberes Backup – oder wirft einen BackupFehler mit Erklärung. */
export function pruefeBackup(daten: unknown): Backup {
  if (typeof daten !== 'object' || daten === null) throw new BackupFehler('Die Datei enthält kein Truhenblick-Backup.');
  const roh = daten as Record<string, unknown>;
  if (roh.app !== 'truhenblick') throw new BackupFehler('Die Datei enthält kein Truhenblick-Backup.');
  if (roh.version !== 1) {
    throw new BackupFehler('Dieses Backup stammt aus einer neueren Version von Truhenblick. Bitte aktualisiere die App.');
  }
  if (!Array.isArray(roh.bereiche) || !Array.isArray(roh.artikel)) {
    throw new BackupFehler('Das Backup ist unvollständig.');
  }
  const bereiche = roh.bereiche.filter(istBereich).map(bereinigeBereich);
  const artikel = roh.artikel.filter(istArtikel).map(bereinigeArtikel);
  const defekt = roh.bereiche.length - bereiche.length + (roh.artikel.length - artikel.length);
  if (defekt > 0) {
    throw new BackupFehler(
      `Das Backup ist beschädigt: ${defekt === 1 ? '1 Eintrag ist' : `${defekt} Einträge sind`} nicht lesbar.`,
    );
  }
  return {
    app: 'truhenblick',
    version: 1,
    exportiertAm: typeof roh.exportiertAm === 'string' ? roh.exportiertAm : '',
    bereiche,
    artikel,
  };
}

export function leseBackup(text: string): Backup {
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new BackupFehler('Die Datei ist keine gültige JSON-Datei.');
  }
  return pruefeBackup(daten);
}

export type ImportModus = 'zusammenfuehren' | 'ersetzen';

interface Tabelle<T extends SyncDoc> {
  toArray(): Promise<(T & Lokal)[]>;
  bulkPut(docs: (T & Lokal)[]): Promise<unknown>;
}

async function importiere<T extends SyncDoc>(tabelle: Tabelle<T>, eingehend: T[], modus: ImportModus): Promise<number> {
  const vorhanden = new Map((await tabelle.toArray()).map((d) => [d.id, d]));
  const schreiben: (T & Lokal)[] = [];

  if (modus === 'zusammenfuehren') {
    // Je Datensatz gewinnt die jüngere Fassung – wie beim Abgleich zwischen Geräten.
    for (const doc of eingehend) {
      if (eingehendeGewinnt<T>(vorhanden.get(doc.id), doc)) schreiben.push({ ...doc, dirty: 1 });
    }
  } else {
    // Danach gilt genau der Stand des Backups. Alles wird neu gestempelt,
    // damit dieser Stand sich auch beim Abgleich mit anderen Geräten durchsetzt.
    const imBackup = new Set(eingehend.map((d) => d.id));
    for (const doc of eingehend) {
      const lokal = vorhanden.get(doc.id);
      const neuer = lokal && lokal.geaendertAm > doc.geaendertAm ? lokal.geaendertAm : doc.geaendertAm;
      schreiben.push({ ...doc, geaendertAm: zeitstempelNach(neuer), dirty: 1 });
    }
    for (const lokal of vorhanden.values()) {
      if (imBackup.has(lokal.id) || lokal.geloeschtAm) continue;
      const jetzt = zeitstempelNach(lokal.geaendertAm);
      schreiben.push({ ...lokal, geloeschtAm: jetzt, geaendertAm: jetzt, dirty: 1 });
    }
  }

  await tabelle.bulkPut(schreiben);
  return schreiben.length;
}

/** Spielt ein Backup ein und liefert, wie viele Datensätze geschrieben wurden. */
export async function importiereBackup(backup: Backup, modus: ImportModus): Promise<number> {
  const anzahl = await db.transaction('rw', db.bereiche, db.artikel, async () => {
    const b = await importiere<Bereich>(db.bereiche, backup.bereiche, modus);
    const a = await importiere<Artikel>(db.artikel, backup.artikel, modus);
    return a + b;
  });
  meldeAenderung();
  return anzahl;
}

/** Bietet das Backup als Datei zum Herunterladen an. */
export async function ladeBackupHerunter(): Promise<string> {
  const backup = await erstelleBackup();
  const name = `truhenblick-backup-${backup.exportiertAm.slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
