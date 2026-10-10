import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { eingehendeGewinnt } from '../../shared/sync.ts';
import type { Artikel, Bereich, SyncAnfrage, SyncAntwort, SyncDoc } from '../../shared/types.ts';

type Tabelle = 'bereiche' | 'artikel';

/** Eine Truhe auf dem Server: eigener Zugangscode, eigene Daten, eigener Zählerstand. */
export interface Truhe {
  /** Zufällige Kennung; die Geräte merken sie sich, um einen Wechsel des Servers zu bemerken. */
  id: string;
  rev: number;
  erstelltAm: string;
}

export interface Speicher {
  /** Legt eine Truhe an. `codeHash` ist die SHA-256-Prüfsumme (hex) ihres Zugangscodes. */
  truheAnlegen(codeHash: string): Truhe;
  /** Findet die Truhe zu einem Zugangscode (über dessen Prüfsumme). */
  truheMitCode(codeHash: string): Truhe | null;
  /** Die zuerst angelegte Truhe – sie gilt als die des Betreibers. */
  ersteTruhe(): Truhe | null;
  anzahlTruhen(): number;
  /** Ersetzt den Zugangscode einer Truhe. Der bisherige gilt danach nicht mehr. */
  codeSetzen(truheId: string, codeHash: string): void;
  /** Nimmt Änderungen eines Geräts an und liefert alles, was es seit `seit` noch nicht kennt. */
  sync(truheId: string, anfrage: SyncAnfrage): SyncAntwort;
  /** Prüfsumme des SYNC_TOKEN, der zuletzt auf die erste Truhe angewandt wurde (siehe app.ts). */
  envHashLesen(): string | null;
  envHashSchreiben(hash: string): void;
  stand(): { truhen: number; datensaetze: number };
  schliessen(): void;
}

const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS truhen (
    id          TEXT    PRIMARY KEY,
    code_hash   TEXT    NOT NULL UNIQUE,
    rev         INTEGER NOT NULL DEFAULT 0,
    erstellt_am TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS docs (
    truhe        TEXT    NOT NULL,
    tabelle      TEXT    NOT NULL,
    id           TEXT    NOT NULL,
    geaendert_am TEXT    NOT NULL,
    rev          INTEGER NOT NULL,
    daten        TEXT    NOT NULL,
    PRIMARY KEY (truhe, tabelle, id)
  );
  CREATE INDEX IF NOT EXISTS docs_truhe_rev ON docs (truhe, rev);
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Bis Version 0.2 gab es genau einen Datenbestand je Server und einen Zugangscode aus der
 * Konfiguration. Er wird zur ersten Truhe: mit derselben Kennung (die Geräte kennen sie als
 * „serverId“ und müssen so nicht neu abgleichen) und demselben Zählerstand. War in der App
 * ein neuer Code erzeugt worden, gilt dieser weiter – sonst setzt app.ts beim Start den
 * Code aus SYNC_TOKEN ein.
 */
function uebernehmeAltbestand(db: Database.Database): void {
  const spalten = db.prepare<[], { name: string }>("SELECT name FROM pragma_table_info('docs')").all();
  if (spalten.length === 0 || spalten.some((s) => s.name === 'truhe')) return;

  const meta = (key: string) =>
    db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  const id = meta('serverId') ?? randomUUID();
  const codeHash = meta('code_hash');
  const envHash = meta('code_env_hash');

  db.exec('ALTER TABLE docs RENAME TO docs_v1; DROP INDEX IF EXISTS docs_rev;');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO truhen (id, code_hash, rev, erstellt_am) VALUES (?, ?, ?, ?)').run(
    id,
    // Ohne bekannten Code bleibt die Truhe verschlossen, bis app.ts den aus SYNC_TOKEN einsetzt.
    codeHash ?? `unbesetzt:${randomUUID()}`,
    Number(meta('rev') ?? 0),
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO docs (truhe, tabelle, id, geaendert_am, rev, daten) SELECT ?, tabelle, id, geaendert_am, rev, daten FROM docs_v1').run(id);
  db.exec("DROP TABLE docs_v1; DELETE FROM meta WHERE key IN ('serverId', 'rev', 'code_hash', 'code_env_hash');");
  const merke = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  merke.run('erste_truhe', id);
  if (codeHash && envHash) merke.run('env_hash', envHash);
}

/**
 * Öffnet (oder erstellt) die SQLite-Datenbank.
 *
 * Jeder Datensatz liegt als JSON in `docs`, getrennt nach Truhe. `rev` ist ein fortlaufender
 * Zähler je Truhe: Bei jeder angenommenen Änderung bekommt der Datensatz die nächste Nummer,
 * so kann ein Gerät gezielt „alles nach rev N“ abholen. Gelöschtes bleibt als Datensatz mit
 * `geloeschtAm` erhalten, damit die Löschung alle Geräte erreicht.
 */
export function oeffneSpeicher(pfad: string): Speicher {
  const db = new Database(pfad);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  if ((db.pragma('user_version', { simple: true }) as number) < SCHEMA_VERSION) {
    db.transaction(() => {
      uebernehmeAltbestand(db);
      db.exec(SCHEMA);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  interface TruheZeile {
    id: string;
    rev: number;
    erstellt_am: string;
  }
  const alsTruhe = (z: TruheZeile | undefined): Truhe | null => (z ? { id: z.id, rev: z.rev, erstelltAm: z.erstellt_am } : null);

  const metaLesen = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?');
  const metaSchreiben = db.prepare<[string, string]>(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const truheEinfuegen = db.prepare<[string, string, string]>(
    'INSERT INTO truhen (id, code_hash, rev, erstellt_am) VALUES (?, ?, 0, ?)',
  );
  const truheNachCode = db.prepare<[string], TruheZeile>('SELECT id, rev, erstellt_am FROM truhen WHERE code_hash = ?');
  const truheNachId = db.prepare<[string], TruheZeile>('SELECT id, rev, erstellt_am FROM truhen WHERE id = ?');
  const truhenZaehlen = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM truhen');
  const codeAendern = db.prepare<[string, string]>('UPDATE truhen SET code_hash = ? WHERE id = ?');
  const revSetzen = db.prepare<[number, string]>('UPDATE truhen SET rev = ? WHERE id = ?');
  const lesen = db.prepare<[string, Tabelle, string], { daten: string }>(
    'SELECT daten FROM docs WHERE truhe = ? AND tabelle = ? AND id = ?',
  );
  const schreiben = db.prepare<[string, Tabelle, string, string, number, string]>(`
    INSERT INTO docs (truhe, tabelle, id, geaendert_am, rev, daten) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (truhe, tabelle, id) DO UPDATE SET geaendert_am = excluded.geaendert_am, rev = excluded.rev, daten = excluded.daten
  `);
  const seitRev = db.prepare<[string, Tabelle, number], { daten: string }>(
    'SELECT daten FROM docs WHERE truhe = ? AND tabelle = ? AND rev > ? ORDER BY rev',
  );
  const zaehlen = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM docs');

  const truheAnlegen = db.transaction((codeHash: string): Truhe => {
    const id = randomUUID();
    const erstelltAm = new Date().toISOString();
    truheEinfuegen.run(id, codeHash, erstelltAm);
    if (!metaLesen.get('erste_truhe')) metaSchreiben.run('erste_truhe', id);
    return { id, rev: 0, erstelltAm };
  });

  function uebernehme<T extends SyncDoc>(truhe: string, tabelle: Tabelle, docs: T[], rev: number): number {
    for (const doc of docs) {
      const zeile = lesen.get(truhe, tabelle, doc.id);
      const vorhanden = zeile ? (JSON.parse(zeile.daten) as T) : undefined;
      if (!eingehendeGewinnt(vorhanden, doc)) continue;
      rev += 1;
      schreiben.run(truhe, tabelle, doc.id, doc.geaendertAm, rev, JSON.stringify(doc));
    }
    return rev;
  }

  const sync = db.transaction((truheId: string, anfrage: SyncAnfrage): SyncAntwort => {
    const vorher = truheNachId.get(truheId)?.rev ?? 0;
    let rev = uebernehme(truheId, 'bereiche', anfrage.bereiche, vorher);
    rev = uebernehme(truheId, 'artikel', anfrage.artikel, rev);
    if (rev !== vorher) revSetzen.run(rev, truheId);
    // Kennt das Gerät einen höheren Stand als wir (Datenbank wurde zurückgespielt), bekommt es alles.
    const seit = anfrage.seit > vorher ? 0 : anfrage.seit;
    return {
      serverId: truheId,
      rev,
      bereiche: seitRev.all(truheId, 'bereiche', seit).map((z) => JSON.parse(z.daten) as Bereich),
      artikel: seitRev.all(truheId, 'artikel', seit).map((z) => JSON.parse(z.daten) as Artikel),
    };
  });

  return {
    truheAnlegen: (codeHash) => truheAnlegen.immediate(codeHash),
    truheMitCode: (codeHash) => alsTruhe(truheNachCode.get(codeHash)),
    ersteTruhe: () => {
      const id = metaLesen.get('erste_truhe')?.value;
      return id ? alsTruhe(truheNachId.get(id)) : null;
    },
    anzahlTruhen: () => truhenZaehlen.get()?.n ?? 0,
    codeSetzen: (truheId, codeHash) => {
      codeAendern.run(codeHash, truheId);
    },
    sync: (truheId, anfrage) => sync.immediate(truheId, anfrage),
    envHashLesen: () => metaLesen.get('env_hash')?.value ?? null,
    envHashSchreiben: (hash) => {
      metaSchreiben.run('env_hash', hash);
    },
    stand: () => ({ truhen: truhenZaehlen.get()?.n ?? 0, datensaetze: zaehlen.get()?.n ?? 0 }),
    schliessen: () => db.close(),
  };
}
