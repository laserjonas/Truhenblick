import { useMemo, useState } from 'react';
import { ArtikelZeile } from '../components/ArtikelZeile.tsx';
import { HochIcon, RunterIcon } from '../components/Icons.tsx';
import { Kopfzeile, type FilterZustand } from '../components/Kopfzeile.tsx';
import { useDaten } from '../hooks/useDaten.tsx';
import { sortiereArtikel, sucheArtikel, type Sortierung } from '../logic/suche.ts';

const SORTIERUNGEN: { id: Sortierung; name: string }[] = [
  { id: 'ablauf', name: 'Haltbar bis' },
  { id: 'name', name: 'Name' },
  { id: 'eingefroren', name: 'Eingefroren am' },
  { id: 'kategorie', name: 'Kategorie' },
  { id: 'bereich', name: 'Bereich' },
];

const MERKER = 'truhenblick.sortierung';

function gemerkt(): { sortierung: Sortierung; absteigend: boolean } {
  try {
    const roh = JSON.parse(localStorage.getItem(MERKER) ?? 'null') as { sortierung?: string; absteigend?: boolean } | null;
    const bekannt = SORTIERUNGEN.find((s) => s.id === roh?.sortierung);
    if (bekannt) return { sortierung: bekannt.id, absteigend: roh?.absteigend === true };
  } catch {
    // Unlesbarer Merker – Standard verwenden.
  }
  return { sortierung: 'ablauf', absteigend: false };
}

/** Das ganze Inventar als sortierbare Liste – die Alternative zur Grafik. */
export function ListePage({ filter }: { filter: FilterZustand }) {
  const { artikel, ortVon } = useDaten();
  const [{ sortierung, absteigend }, setSort] = useState(gemerkt);

  function merke(neu: { sortierung: Sortierung; absteigend: boolean }) {
    setSort(neu);
    try {
      localStorage.setItem(MERKER, JSON.stringify(neu));
    } catch {
      // Dann gilt die Wahl nur bis zum Schließen.
    }
  }

  const liste = useMemo(() => {
    const inKategorie = filter.kategorie ? artikel.filter((a) => a.kategorie === filter.kategorie) : artikel;
    const gesucht = filter.suche.trim() ? sucheArtikel(inKategorie, filter.suche) : inKategorie;
    const sortiert = sortiereArtikel(gesucht, sortierung, ortVon);
    return absteigend ? sortiert.reverse() : sortiert;
  }, [artikel, filter.kategorie, filter.suche, sortierung, absteigend, ortVon]);

  return (
    <>
      <Kopfzeile filter={filter} titel="Liste">
        <div className="flex items-center gap-2">
          <label htmlFor="sortierung" className="text-text2 shrink-0 text-sm font-medium">
            Sortieren nach
          </label>
          <select
            id="sortierung"
            className="feld min-h-11 min-w-0 flex-1 px-3"
            value={sortierung}
            onChange={(e) => merke({ sortierung: e.target.value as Sortierung, absteigend })}
          >
            {SORTIERUNGEN.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rund border-rand bg-karte border"
            aria-label={absteigend ? 'Absteigend sortiert – auf aufsteigend wechseln' : 'Aufsteigend sortiert – auf absteigend wechseln'}
            onClick={() => merke({ sortierung, absteigend: !absteigend })}
          >
            {absteigend ? <RunterIcon /> : <HochIcon />}
          </button>
        </div>
      </Kopfzeile>

      <main className="mx-auto max-w-2xl px-3 pb-44">
        <p className="text-text2 mb-1.5 px-1 text-sm font-medium" role="status">
          {liste.length === 1 ? '1 Artikel' : `${liste.length} Artikel`}
          {liste.length !== artikel.length && ` von ${artikel.length}`}
        </p>
        {liste.length === 0 ? (
          <p className="karte text-text2 p-4 text-center">
            {artikel.length === 0 ? 'Deine Truhe ist noch leer.' : 'Nichts gefunden.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {liste.map((a) => (
              <ArtikelZeile key={a.id} artikel={a} zeigeOrt />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
