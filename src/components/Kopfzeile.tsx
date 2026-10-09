import { useMemo, type ReactNode } from 'react';
import { useDaten } from '../hooks/useDaten.tsx';
import { KategorieFilter } from './KategorieFilter.tsx';
import { Suchleiste } from './Suchleiste.tsx';

export interface FilterZustand {
  suche: string;
  setSuche: (wert: string) => void;
  kategorie: string | null;
  setKategorie: (wert: string | null) => void;
}

/** Fest stehender Kopf mit Suche und Kategoriefilter (Truhe und Liste teilen sich den Zustand). */
export function Kopfzeile({ filter, titel, children }: { filter: FilterZustand; titel: string; children?: ReactNode }) {
  const { artikel } = useDaten();
  const vorhanden = useMemo(() => new Set(artikel.map((a) => a.kategorie)), [artikel]);

  return (
    <header className="bg-grund/95 sticky top-0 z-20 px-3 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <h1 className="sr-only">{titel}</h1>
        <Suchleiste wert={filter.suche} onChange={filter.setSuche} />
        <KategorieFilter
          wert={filter.kategorie}
          onChange={filter.setKategorie}
          mitAlle
          vorhanden={vorhanden}
          beschriftung="Nach Kategorie filtern"
        />
        {children}
      </div>
    </header>
  );
}
