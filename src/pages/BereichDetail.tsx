import { useMemo } from 'react';
import type { Artikel } from '../../shared/types.ts';
import { ArtikelZeile } from '../components/ArtikelZeile.tsx';
import { Blatt } from '../components/Blatt.tsx';
import { PlusIcon } from '../components/Icons.tsx';
import { useArtikelJeBereich, useDaten } from '../hooks/useDaten.tsx';
import { gehe } from '../hooks/useRoute.ts';
import { STATUS_RANG, statusVon } from '../logic/haltbarkeit.ts';
import { bereichPfad, OHNE_BEREICH } from '../logic/truhe.ts';

interface Gruppe {
  id: string;
  titel: string | null;
  artikel: Artikel[];
}

/** Alle Artikel eines Bereichs; bei einer Ebene mit Fächern nach Fach gegliedert. */
export function BereichDetail({ id }: { id: string }) {
  const { artikel, bereiche, heute } = useDaten();
  const jeBereich = useArtikelJeBereich(artikel);
  const bereich = bereiche.find((b) => b.id === id);
  const heimatlos = id === OHNE_BEREICH;

  const gruppen = useMemo<Gruppe[]>(() => {
    const sortiert = (liste: Artikel[] = []) =>
      [...liste].sort(
        (a, b) =>
          STATUS_RANG[statusVon(a, heute)] - STATUS_RANG[statusVon(b, heute)] || a.name.localeCompare(b.name, 'de'),
      );
    const faecher = bereiche
      .filter((b) => b.typ === 'fach' && b.parentId === id)
      .sort((a, b) => a.reihenfolge - b.reihenfolge);
    if (faecher.length === 0) return [{ id, titel: null, artikel: sortiert(jeBereich.get(id)) }];
    const direkt = sortiert(jeBereich.get(id));
    return [
      ...(direkt.length > 0 ? [{ id, titel: 'Ohne Fach', artikel: direkt }] : []),
      ...faecher.map((f) => ({ id: f.id, titel: f.name, artikel: sortiert(jeBereich.get(f.id)) })),
    ];
  }, [bereiche, jeBereich, id, heute]);

  if (!bereich && !heimatlos) {
    return (
      <Blatt titel="Bereich nicht gefunden">
        <p className="text-text2 p-4 text-center">Diesen Bereich gibt es nicht mehr.</p>
      </Blatt>
    );
  }

  const titel = bereich ? bereichPfad(bereich, bereiche) : 'Nicht zugeordnet';
  const anzahl = gruppen.reduce((n, g) => n + g.artikel.length, 0);

  return (
    <Blatt
      titel={titel}
      untertitel={anzahl === 1 ? '1 Artikel' : `${anzahl} Artikel`}
      fuss={
        bereich && (
          <button type="button" className="knopf knopf-primaer w-full" onClick={() => gehe(`/neu/${bereich.id}`)}>
            <PlusIcon />
            Hier einlagern
          </button>
        )
      }
    >
      {heimatlos && (
        <p className="text-text2 mb-3 text-sm">
          Der Bereich dieser Artikel wurde gelöscht. Tippe einen Artikel an, um ihm einen neuen Platz zu geben.
        </p>
      )}
      {anzahl === 0 && <p className="text-text2 p-6 text-center">Hier liegt noch nichts.</p>}
      <div className="flex flex-col gap-4">
        {gruppen.map((g) =>
          g.titel === null && g.artikel.length === 0 ? null : (
            <section key={g.id} aria-label={g.titel ?? titel}>
              {g.titel !== null && (
                <h2 className="text-text2 mb-1.5 flex items-baseline gap-2 px-1 text-sm font-bold">
                  {g.titel}
                  <span className="font-medium">{g.artikel.length === 0 ? 'leer' : g.artikel.length}</span>
                </h2>
              )}
              <ul className="flex flex-col gap-1.5">
                {g.artikel.map((a) => (
                  <ArtikelZeile key={a.id} artikel={a} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </Blatt>
  );
}
