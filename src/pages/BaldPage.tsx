import { useMemo } from 'react';
import type { Artikel } from '../../shared/types.ts';
import { ArtikelZeile } from '../components/ArtikelZeile.tsx';
import { STATUS_TEXT } from '../components/ArtikelChip.tsx';
import { StatusSymbol } from '../components/Icons.tsx';
import { BALD_VERBRAUCHEN_TAGE } from '../config/ampel.ts';
import { useDaten } from '../hooks/useDaten.tsx';
import { restText, resttage, statusVon, type Status } from '../logic/haltbarkeit.ts';
import { sortiereArtikel } from '../logic/suche.ts';

function Gruppe({ status, titel, artikel }: { status: Status; titel: string; artikel: Artikel[] }) {
  if (artikel.length === 0) return null;
  return (
    <section aria-label={titel}>
      <h2 className={`mb-1.5 flex items-center gap-1.5 px-1 font-bold ${STATUS_TEXT[status]}`}>
        <StatusSymbol status={status} width={18} height={18} strokeWidth={2.6} />
        {titel}
        <span className="text-text2 font-medium">{artikel.length}</span>
      </h2>
      <ul className="flex flex-col gap-1.5">
        {artikel.map((a) => (
          <ArtikelZeile key={a.id} artikel={a} zeigeOrt />
        ))}
      </ul>
    </section>
  );
}

/** Was zuerst weg muss: Überfälliges und alles, was bald abläuft – nach Ablauf sortiert. */
export function BaldPage() {
  const { artikel, heute } = useDaten();

  const { ueberfaellig, bald, naechster } = useMemo(() => {
    const sortiert = sortiereArtikel(artikel, 'ablauf');
    return {
      ueberfaellig: sortiert.filter((a) => statusVon(a, heute) === 'ueberfaellig'),
      bald: sortiert.filter((a) => statusVon(a, heute) === 'bald'),
      naechster: sortiert.find((a) => statusVon(a, heute) === 'frisch'),
    };
  }, [artikel, heute]);

  const nichts = ueberfaellig.length === 0 && bald.length === 0;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-3 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-44">
      <header className="px-1">
        <h1 className="text-2xl font-bold">Bald verbrauchen</h1>
        <p className="text-text2 text-sm">Was in den nächsten {BALD_VERBRAUCHEN_TAGE} Tagen abläuft oder schon drüber ist.</p>
      </header>

      {nichts && (
        <div className="karte p-5 text-center">
          <p className="text-3xl" aria-hidden="true">
            🎉
          </p>
          <p className="mt-1 font-semibold">Alles im grünen Bereich</p>
          <p className="text-text2 mt-1 text-sm">
            {naechster
              ? `Als Nächstes ist ${naechster.name} dran (${restText(resttage(naechster, heute))}).`
              : 'Deine Truhe ist leer.'}
          </p>
        </div>
      )}

      <Gruppe status="ueberfaellig" titel="Überfällig" artikel={ueberfaellig} />
      <Gruppe status="bald" titel="Bald verbrauchen" artikel={bald} />
    </main>
  );
}
