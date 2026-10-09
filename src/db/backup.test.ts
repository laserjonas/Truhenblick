import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackupFehler, erstelleBackup, importiereBackup, leseBackup, pruefeBackup } from './backup.ts';
import { db } from './db.ts';
import { artikelAendern, artikelAnlegen, artikelEntnehmen, bereichAnlegen } from './repo.ts';

async function fuelle() {
  const korb = await bereichAnlegen('Korb', 'korb');
  const hack = await artikelAnlegen({
    name: 'Hackfleisch',
    kategorie: 'fleisch',
    emoji: '🥩',
    menge: 2,
    einheit: 'packung',
    eingefrorenAm: '2026-10-09',
    haltbarBis: '2027-01-09',
    bereichId: korb.id,
    notiz: '',
  });
  return { korb, hack };
}

beforeEach(async () => {
  await Promise.all([db.bereiche.clear(), db.artikel.clear(), db.meta.clear()]);
});

describe('Backup erstellen und prüfen', () => {
  it('enthält alle Daten ohne lokale Zusatzfelder und übersteht den Weg durch JSON', async () => {
    const { hack } = await fuelle();
    await artikelEntnehmen(hack.id);
    const backup = await erstelleBackup();
    expect(backup.bereiche).toHaveLength(1);
    expect(backup.artikel).toHaveLength(1);
    expect(backup.artikel[0]?.geloeschtAm).not.toBeNull();
    expect(backup.artikel[0]).not.toHaveProperty('dirty');
    expect(leseBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it('weist Fremdes und Beschädigtes verständlich zurück', () => {
    expect(() => leseBackup('kein json')).toThrow(BackupFehler);
    expect(() => pruefeBackup({ app: 'anders' })).toThrow(/kein Truhenblick-Backup/);
    expect(() => pruefeBackup({ app: 'truhenblick', version: 2, bereiche: [], artikel: [] })).toThrow(/neueren Version/);
    expect(() => pruefeBackup({ app: 'truhenblick', version: 1, bereiche: [] })).toThrow(/unvollständig/);
    expect(() => pruefeBackup({ app: 'truhenblick', version: 1, bereiche: [{ id: 'x' }], artikel: [] })).toThrow(
      /1 Eintrag ist nicht lesbar/,
    );
  });
});

describe('Backup einspielen', () => {
  it('stellt auf einem leeren Gerät alles wieder her', async () => {
    await fuelle();
    const backup = await erstelleBackup();
    await Promise.all([db.bereiche.clear(), db.artikel.clear()]);

    expect(await importiereBackup(backup, 'zusammenfuehren')).toBe(2);
    expect(await db.bereiche.count()).toBe(1);
    expect((await db.artikel.toArray())[0]?.name).toBe('Hackfleisch');
  });

  it('führt zusammen: die jüngere Fassung gewinnt, Neues bleibt', async () => {
    const { korb, hack } = await fuelle();
    const backup = await erstelleBackup();

    await artikelAendern(hack.id, { menge: 5 });
    const neu = await artikelAnlegen({ ...backup.artikel[0]!, name: 'Erbsen', bereichId: korb.id });

    await importiereBackup(backup, 'zusammenfuehren');
    expect((await db.artikel.get(hack.id))?.menge).toBe(5);
    expect((await db.artikel.get(neu.id))?.geloeschtAm).toBeNull();
  });

  it('ersetzt: danach gilt genau der Stand des Backups', async () => {
    const { korb, hack } = await fuelle();
    const backup = await erstelleBackup();

    await artikelAendern(hack.id, { menge: 5 });
    const neu = await artikelAnlegen({ ...backup.artikel[0]!, name: 'Erbsen', bereichId: korb.id });
    const spaeter = (await db.artikel.get(hack.id))!.geaendertAm;

    await importiereBackup(backup, 'ersetzen');
    const zurueck = (await db.artikel.get(hack.id))!;
    expect(zurueck.menge).toBe(2);
    // Neu gestempelt, damit sich der Stand beim Abgleich durchsetzt
    expect(Date.parse(zurueck.geaendertAm)).toBeGreaterThan(Date.parse(spaeter));
    expect(zurueck.dirty).toBe(1);
    expect((await db.artikel.get(neu.id))?.geloeschtAm).not.toBeNull();
    expect((await db.bereiche.get(korb.id))?.geloeschtAm).toBeNull();
  });
});
