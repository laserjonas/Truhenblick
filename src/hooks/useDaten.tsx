import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Artikel, Bereich } from '../../shared/types.ts';
import { db } from '../db/db.ts';
import { heuteIso } from '../logic/datum.ts';
import { artikelJeBereich, baueStruktur, bereichPfad, type TruhenStruktur } from '../logic/truhe.ts';

export interface Daten {
  /** Alle nicht gelöschten Bereiche */
  bereiche: Bereich[];
  /** Alle nicht entnommenen Artikel */
  artikel: Artikel[];
  struktur: TruhenStruktur;
  heute: string;
  /** Anzeigename des Bereichs, in dem ein Artikel liegt */
  ortVon: (artikel: Artikel) => string;
}

const DatenContext = createContext<Daten | null>(null);

/** Aktuelles Datum; springt um, wenn die App nach Mitternacht wieder in den Vordergrund kommt. */
function useHeute(): string {
  const [heute, setHeute] = useState(() => heuteIso());
  useEffect(() => {
    const pruefe = () => setHeute(heuteIso());
    document.addEventListener('visibilitychange', pruefe);
    window.addEventListener('focus', pruefe);
    return () => {
      document.removeEventListener('visibilitychange', pruefe);
      window.removeEventListener('focus', pruefe);
    };
  }, []);
  return heute;
}

/** Lädt Bereiche und Artikel live aus IndexedDB. `undefined`, solange der erste Lesevorgang läuft. */
export function useGeladeneDaten(): Daten | undefined {
  const bereiche = useLiveQuery(() => db.bereiche.filter((b) => !b.geloeschtAm).toArray(), []);
  const artikel = useLiveQuery(() => db.artikel.filter((a) => !a.geloeschtAm).toArray(), []);
  const heute = useHeute();

  return useMemo(() => {
    if (!bereiche || !artikel) return undefined;
    const nachId = new Map(bereiche.map((b) => [b.id, b]));
    return {
      bereiche,
      artikel,
      struktur: baueStruktur(bereiche),
      heute,
      ortVon: (a: Artikel) => {
        const b = nachId.get(a.bereichId);
        return b ? bereichPfad(b, bereiche) : 'Nicht zugeordnet';
      },
    };
  }, [bereiche, artikel, heute]);
}

export function DatenProvider({ daten, children }: { daten: Daten; children: ReactNode }) {
  return <DatenContext.Provider value={daten}>{children}</DatenContext.Provider>;
}

export function useDaten(): Daten {
  const daten = useContext(DatenContext);
  if (!daten) throw new Error('useDaten außerhalb des DatenProvider verwendet');
  return daten;
}

/** Artikel je Bereich (bereits gefiltert) – für die Truhengrafik. */
export function useArtikelJeBereich(artikel: readonly Artikel[]): Map<string, Artikel[]> {
  const { bereiche } = useDaten();
  return useMemo(() => artikelJeBereich(artikel, bereiche), [artikel, bereiche]);
}
