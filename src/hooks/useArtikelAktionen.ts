import { useMemo } from 'react';
import type { Artikel } from '../../shared/types.ts';
import { useSnackbar } from '../components/Snackbar.tsx';
import { artikelEntnehmen, artikelWiederherstellen, mengeAendern } from '../db/repo.ts';

/** Menge ändern und Entnehmen – jeweils mit „Rückgängig“ in der Snackbar. */
export function useArtikelAktionen() {
  const zeige = useSnackbar();

  return useMemo(() => {
    const entnommenMelden = (vorher: Artikel) =>
      zeige({
        text: `${vorher.emoji} ${vorher.name} entnommen`,
        aktion: { name: 'Rückgängig', ausfuehren: () => artikelWiederherstellen(vorher) },
      });

    return {
      async menge(artikel: Artikel, richtung: -1 | 1): Promise<void> {
        const ergebnis = await mengeAendern(artikel.id, richtung);
        if (ergebnis?.entnommen) entnommenMelden(ergebnis.vorher);
      },
      async entnehmen(artikel: Artikel): Promise<void> {
        const vorher = await artikelEntnehmen(artikel.id);
        if (vorher) entnommenMelden(vorher);
      },
    };
  }, [zeige]);
}
