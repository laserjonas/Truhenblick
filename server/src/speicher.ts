import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { eingehendeGewinnt } from '../../shared/sync.ts';
import type { Artikel, Bereich, SyncAnfrage, SyncAntwort, SyncDoc } from '../../shared/types.ts';

type Tabelle = 'bereiche' | 'artikel';

export interface Speicher {
  /** Nimmt Änderungen eines Geräts an und liefert alles, was es seit `seit` noch nicht kennt. */
  sync(anfrage: SyncAnfrage): SyncAntwort;
  /** Aktueller Stand (für /api/health und Tests) */
  stand(): { serverId: string; rev: number; datensaetze: number };
  schliessen(): void;
}

/**
 * Öffnet (oder erstellt) die SQLite-Datenbank.
 *
 * Jeder Datensatz liegt als JSON in `docs`. `rev` ist ein fortlaufender Zähler:
 * Bei jeder angenommenen Änderung bekommt der Datensatz die nächste Nummer, so
 * kann ein Gerät gezielt „alles nach rev N“ abholen. Gelöschtes bleibt als
 * Datensatz mit `geloeschtAm` erhalten, damit die Löschung alle Geräte erreicht.
 */
export function oeffneSpeicher(pfad: string): Speicher {
  const db = new Database(pfad);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      tabelle      TEXT    NOT NULL,
      id           TEXT    NOT NULL,
      geaendert_am TEXT    NOT NULL,
      rev          INTEGER NOT NULL,
      daten        TEXT    NOT NULL,
      PRIMARY KEY (tabelle, id)
    );
    CREATE INDEX IF NOT EXISTS docs_rev ON docs (rev);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const metaLesen = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?');
  const metaSchreiben = db.prepare<[string, string]>(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const lesen = db.prepare<[Tabelle, string], { daten: string }>('SELECT daten FROM docs WHERE tabelle = ? AND id = ?');
  const schreiben = db.prepare<[Tabelle, string, string, number, string]>(`
    INSERT INTO docs (tabelle, id, geaendert_am, rev, daten) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tabelle, id) DO UPDATE SET geaendert_am = excluded.geaendert_am, rev = excluded.rev, daten = excluded.daten
  `);
  const seitRev = db.prepare<[Tabelle, number], { daten: string }>(
    'SELECT daten FROM docs WHERE tabelle = ? AND rev > ? ORDER BY rev',
  );
  const zaehlen = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM docs');

  if (!metaLesen.get('serverId')) metaSchreiben.run('serverId', randomUUID());
  const serverId = (metaLesen.get('serverId') as { value: string }).value;
  const aktuelleRev = () => Number(metaLesen.get('rev')?.value ?? 0);

  function uebernehme<T extends SyncDoc>(tabelle: Tabelle, docs: T[], rev: number): number {
    for (const doc of docs) {
      const zeile = lesen.get(tabelle, doc.id);
      const vorhanden = zeile ? (JSON.parse(zeile.daten) as T) : undefined;
      if (!eingehendeGewinnt(vorhanden, doc)) continue;
      rev += 1;
      schreiben.run(tabelle, doc.id, doc.geaendertAm, rev, JSON.stringify(doc));
    }
    return rev;
  }

  const sync = db.transaction((anfrage: SyncAnfrage): SyncAntwort => {
    const vorher = aktuelleRev();
    let rev = uebernehme('bereiche', anfrage.bereiche, vorher);
    rev = uebernehme('artikel', anfrage.artikel, rev);
    if (rev !== vorher) metaSchreiben.run('rev', String(rev));
    // Kennt das Gerät einen höheren Stand als wir (Datenbank wurde zurückgespielt), bekommt es alles.
    const seit = anfrage.seit > vorher ? 0 : anfrage.seit;
    return {
      serverId,
      rev,
      bereiche: seitRev.all('bereiche', seit).map((z) => JSON.parse(z.daten) as Bereich),
      artikel: seitRev.all('artikel', seit).map((z) => JSON.parse(z.daten) as Artikel),
    };
  });

  return {
    sync: (anfrage) => sync.immediate(anfrage),
    stand: () => ({ serverId, rev: aktuelleRev(), datensaetze: zaehlen.get()?.n ?? 0 }),
    schliessen: () => db.close(),
  };
}
