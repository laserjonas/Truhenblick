import { useMemo } from 'react';
import type { Artikel } from '../../shared/types.ts';
import { STATUS_FLAECHE } from '../components/ArtikelChip.tsx';
import { StatusSymbol } from '../components/Icons.tsx';
import { InstallHinweis } from '../components/InstallHinweis.tsx';
import { NeueTruheHinweis } from '../components/NeueTruheHinweis.tsx';
import { Kopfzeile, type FilterZustand } from '../components/Kopfzeile.tsx';
import { TruhenGrafik } from '../components/TruhenGrafik.tsx';
import { useArtikelJeBereich, useDaten } from '../hooks/useDaten.tsx';
import { ersetze, gehe } from '../hooks/useRoute.ts';
import { restText, resttage, STATUS_NAME, statusAusResttagen, statusVon, type Status } from '../logic/haltbarkeit.ts';
import { sucheArtikel } from '../logic/suche.ts';
import { OHNE_BEREICH } from '../logic/truhe.ts';

const MAX_TREFFER = 6;
const AMPEL: Status[] = ['frisch', 'bald', 'ueberfaellig'];

/** Startseite: die Truhe von oben, mit Suche und Kategoriefilter. */
export function TruhePage({ filter }: { filter: FilterZustand }) {
  const { artikel, bereiche, struktur, heute, ortVon } = useDaten();
  const { suche, kategorie } = filter;

  const gefiltert = useMemo(
    () => (kategorie ? artikel.filter((a) => a.kategorie === kategorie) : artikel),
    [artikel, kategorie],
  );
  const jeBereich = useArtikelJeBereich(gefiltert);

  const sucht = suche.trim() !== '';
  const treffer = useMemo(() => (sucht ? sucheArtikel(gefiltert, suche) : []), [sucht, gefiltert, suche]);
  const trefferIds = useMemo(() => (sucht ? new Set(treffer.map((a) => a.id)) : null), [sucht, treffer]);
  const trefferBereiche = useMemo(() => {
    if (!sucht) return null;
    const gueltig = new Map(bereiche.map((b) => [b.id, b]));
    const ids = new Set<string>();
    for (const a of treffer) {
      const b = gueltig.get(a.bereichId);
      if (!b) {
        ids.add(OHNE_BEREICH);
        continue;
      }
      ids.add(b.id);
      if (b.parentId) ids.add(b.parentId);
    }
    return ids;
  }, [sucht, treffer, bereiche]);

  const zaehler = useMemo(() => {
    const z: Record<Status, number> = { frisch: 0, bald: 0, ueberfaellig: 0 };
    for (const a of gefiltert) z[statusVon(a, heute)] += 1;
    return z;
  }, [gefiltert, heute]);

  return (
    <>
      <Kopfzeile filter={filter} titel="Truhenblick" />

      <main className="mx-auto flex max-w-5xl flex-col gap-3 px-2 pb-44 sm:px-3">
        <NeueTruheHinweis />

        {sucht && <Suchergebnisse treffer={treffer} heute={heute} ortVon={ortVon} />}

        {artikel.length === 0 && (
          <p className="karte text-text2 p-4 text-center">
            Deine Truhe ist noch leer. Tippe unten auf <strong className="text-text">+ Artikel</strong>, um etwas
            einzulagern.
          </p>
        )}

        <TruhenGrafik
          struktur={struktur}
          jeBereich={jeBereich}
          heute={heute}
          hervorgehoben={trefferBereiche}
          treffer={trefferIds}
          onBereich={(id) => gehe(`/bereich/${id}`)}
        />

        {gefiltert.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Haltbarkeit im Überblick">
            {AMPEL.map((s) => {
              const inhalt = (
                <>
                  <StatusSymbol status={s} width={15} height={15} strokeWidth={2.6} />
                  <span className="font-bold tabular-nums">{zaehler[s]}</span> {STATUS_NAME[s]}
                </>
              );
              const stil = `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${STATUS_FLAECHE[s]}`;
              return (
                <li key={s}>
                  {s === 'frisch' || zaehler[s] === 0 ? (
                    <span className={stil}>{inhalt}</span>
                  ) : (
                    <button type="button" className={`${stil} min-h-11`} onClick={() => ersetze('/bald')}>
                      {inhalt}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <InstallHinweis />
      </main>
    </>
  );
}

function Suchergebnisse({
  treffer,
  heute,
  ortVon,
}: {
  treffer: Artikel[];
  heute: string;
  ortVon: (a: Artikel) => string;
}) {
  if (treffer.length === 0) {
    return (
      <p className="karte text-text2 p-4 text-center" role="status">
        Nichts gefunden.
      </p>
    );
  }
  return (
    <section aria-label="Suchergebnisse" className="px-1 sm:px-0">
      <h2 className="text-text2 mb-1.5 px-1 text-sm font-medium" role="status">
        {treffer.length === 1 ? '1 Treffer' : `${treffer.length} Treffer`} – in der Truhe markiert
      </h2>
      <ul className="karte divide-rand divide-y overflow-hidden">
        {treffer.slice(0, MAX_TREFFER).map((a) => {
          const rest = resttage(a, heute);
          const status = statusAusResttagen(rest);
          return (
            <li key={a.id}>
              <button
                type="button"
                className="active:bg-mulde flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
                onClick={() => gehe(`/artikel/${a.id}`)}
              >
                <span className="text-2xl leading-none" aria-hidden="true">
                  {a.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="text-text2 block truncate text-sm">
                    liegt in: <strong className="text-text font-semibold">{ortVon(a)}</strong>
                  </span>
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_FLAECHE[status]}`}
                >
                  <StatusSymbol status={status} width={13} height={13} strokeWidth={2.6} />
                  {restText(rest)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {treffer.length > MAX_TREFFER && (
        <button type="button" className="text-akzent mt-1 min-h-11 px-1 text-sm font-semibold" onClick={() => ersetze('/liste')}>
          Alle {treffer.length} Treffer in der Liste zeigen
        </button>
      )}
    </section>
  );
}
