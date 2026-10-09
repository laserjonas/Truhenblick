import { useRef, useState } from 'react';
import { useSnackbar } from '../components/Snackbar.tsx';
import { BackupFehler, importiereBackup, ladeBackupHerunter, leseBackup, type Backup, type ImportModus } from '../db/backup.ts';
import { datumAnzeige } from '../logic/datum.ts';

function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return n === 1 ? `1 ${einzahl}` : `${n} ${mehrzahl}`;
}

/** Export und Import aller Daten als JSON-Datei. */
export function Datensicherung() {
  const zeige = useSnackbar();
  const dateiFeld = useRef<HTMLInputElement>(null);
  const [gelesen, setGelesen] = useState<Backup | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function exportieren() {
    const name = await ladeBackupHerunter();
    zeige({ text: `Backup gespeichert: ${name}` });
  }

  async function dateiGewaehlt(datei: File | undefined) {
    setFehler(null);
    setGelesen(null);
    if (!datei) return;
    try {
      setGelesen(leseBackup(await datei.text()));
    } catch (e) {
      setFehler(e instanceof BackupFehler ? e.message : 'Die Datei konnte nicht gelesen werden.');
    } finally {
      if (dateiFeld.current) dateiFeld.current.value = '';
    }
  }

  async function einspielen(modus: ImportModus) {
    if (!gelesen) return;
    setLaeuft(true);
    try {
      await importiereBackup(gelesen, modus);
      zeige({ text: modus === 'ersetzen' ? 'Backup eingespielt – alter Stand ersetzt' : 'Backup eingespielt und zusammengeführt' });
      setGelesen(null);
    } catch {
      setFehler('Das Backup konnte nicht eingespielt werden.');
    } finally {
      setLaeuft(false);
    }
  }

  const aktiveArtikel = gelesen?.artikel.filter((a) => !a.geloeschtAm).length ?? 0;
  const aktiveBereiche = gelesen?.bereiche.filter((b) => !b.geloeschtAm).length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="knopf knopf-leise sm:flex-1" onClick={() => void exportieren()}>
          Backup speichern
        </button>
        <button type="button" className="knopf knopf-leise sm:flex-1" onClick={() => dateiFeld.current?.click()}>
          Backup einspielen …
        </button>
        <input
          ref={dateiFeld}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Backup-Datei auswählen"
          onChange={(e) => void dateiGewaehlt(e.target.files?.[0])}
        />
      </div>

      {fehler && (
        <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
          {fehler}
        </p>
      )}

      {gelesen && (
        <div className="border-akzent bg-akzent-weich flex flex-col gap-3 rounded-2xl border p-3" role="group" aria-label="Backup einspielen">
          <p>
            <strong>
              Backup{gelesen.exportiertAm ? ` vom ${datumAnzeige(gelesen.exportiertAm.slice(0, 10))}` : ''}
            </strong>{' '}
            mit {anzahl(aktiveArtikel, 'Artikel', 'Artikeln')} in {anzahl(aktiveBereiche, 'Bereich', 'Bereichen')}.
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" className="knopf knopf-primaer" disabled={laeuft} onClick={() => void einspielen('zusammenfuehren')}>
              Zusammenführen
            </button>
            <p className="text-sm">Behält, was seit dem Backup dazukam. Je Artikel gilt die jüngste Änderung.</p>
            <button type="button" className="knopf knopf-gefahr" disabled={laeuft} onClick={() => void einspielen('ersetzen')}>
              Alles ersetzen
            </button>
            <p className="text-sm">Stellt genau den Stand des Backups wieder her. Alles andere wird entfernt.</p>
            <button type="button" className="knopf knopf-leise" disabled={laeuft} onClick={() => setGelesen(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
