import type { ReactNode } from 'react';
import type { Artikel, Bereich } from '../../shared/types.ts';
import { STATUS_RANG, statusVon } from '../logic/haltbarkeit.ts';
import { fachSpalten, OHNE_BEREICH, type TruhenStruktur } from '../logic/truhe.ts';
import { ArtikelChip } from './ArtikelChip.tsx';
import { HakenIcon, WeiterIcon } from './Icons.tsx';

/**
 * anzeige: Kacheln zeigen ihre Artikel, Tipp öffnet den Bereich.
 * auswahl: kompakte Kacheln zum Auswählen eines Bereichs (Artikel einlagern/verschieben).
 * vorschau: nicht bedienbar (Einrichtungsassistent).
 */
type Modus = 'anzeige' | 'auswahl' | 'vorschau';

interface Props {
  struktur: TruhenStruktur;
  jeBereich?: ReadonlyMap<string, Artikel[]>;
  heute?: string;
  modus?: Modus;
  ausgewaehlt?: string | null;
  /** Bereiche mit Suchtreffern – alle anderen treten zurück */
  hervorgehoben?: ReadonlySet<string> | null;
  /** IDs der Artikel, die Suchtreffer sind */
  treffer?: ReadonlySet<string> | null;
  onBereich?: (id: string) => void;
}

const MAX_CHIPS = 8;

const KORB_SPALTEN: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

const FACH_SPALTEN: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

const LEER: Artikel[] = [];

interface HuelleProps {
  onClick?: () => void;
  gedrueckt?: boolean;
  className: string;
  children: ReactNode;
}

/** Rahmen einer Kachel: Knopf, wenn bedienbar – sonst nur Darstellung. */
function Huelle({ onClick, gedrueckt, className, children }: HuelleProps) {
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      className={`${className} text-left active:brightness-95`}
      aria-pressed={gedrueckt}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function anzahlText(n: number): string {
  return n === 1 ? '1 Artikel' : `${n} Artikel`;
}

export function TruhenGrafik({
  struktur,
  jeBereich,
  heute = '',
  modus = 'anzeige',
  ausgewaehlt = null,
  hervorgehoben = null,
  treffer = null,
  onBereich,
}: Props) {
  const artikelIn = (id: string) => jeBereich?.get(id) ?? LEER;

  function sortiert(liste: Artikel[]): Artikel[] {
    return [...liste].sort(
      (a, b) =>
        Number(treffer?.has(b.id) ?? false) - Number(treffer?.has(a.id) ?? false) ||
        STATUS_RANG[statusVon(a, heute)] - STATUS_RANG[statusVon(b, heute)] ||
        a.name.localeCompare(b.name, 'de'),
    );
  }

  function chips(liste: Artikel[]): ReactNode {
    if (modus !== 'anzeige') return null;
    if (liste.length === 0) return <span className="text-text2 text-[13px]">leer</span>;
    const alle = sortiert(liste);
    const sichtbar = alle.slice(0, MAX_CHIPS);
    return (
      <span className="flex flex-wrap gap-1">
        {sichtbar.map((a) => (
          <ArtikelChip
            key={a.id}
            artikel={a}
            heute={heute}
            betont={treffer?.has(a.id) ?? false}
            gedimmt={treffer !== null && !treffer.has(a.id)}
          />
        ))}
        {alle.length > sichtbar.length && (
          <span className="text-text2 px-1 text-[13px] leading-6 font-medium">
            +{alle.length - sichtbar.length} weitere
          </span>
        )}
      </span>
    );
  }

  /** Hintergrund und Hervorhebung einer Kachel */
  function zustand(id: string): string {
    if (modus === 'auswahl' && ausgewaehlt === id) return 'bg-akzent text-akzent-text border-akzent border-solid';
    if (hervorgehoben?.has(id)) return 'bg-karte ring-akzent ring-[3px]';
    if (hervorgehoben) return 'bg-karte opacity-45';
    return 'bg-karte';
  }

  function huelle(id: string): Pick<HuelleProps, 'onClick' | 'gedrueckt'> {
    return {
      onClick: modus !== 'vorschau' && onBereich ? () => onBereich(id) : undefined,
      gedrueckt: modus === 'auswahl' ? ausgewaehlt === id : undefined,
    };
  }

  function kachel(bereich: Bereich, art: 'korb' | 'ebene' | 'fach'): ReactNode {
    const liste = artikelIn(bereich.id);
    const gewaehlt = modus === 'auswahl' && ausgewaehlt === bereich.id;
    const rahmen = gewaehlt
      ? art === 'korb'
        ? 'border-2'
        : 'border'
      : art === 'korb'
        ? 'border-2 border-dashed border-truhe-rand'
        : 'border border-rand';
    const hoehe = modus === 'anzeige' ? 'min-h-[4.5rem]' : 'min-h-14';
    return (
      <Huelle
        key={bereich.id}
        {...huelle(bereich.id)}
        className={`flex w-full min-w-0 flex-col gap-1.5 rounded-2xl p-1.5 sm:p-2.5 ${rahmen} ${hoehe} ${zustand(bereich.id)}`}
      >
        <span className="flex items-center gap-1.5 px-0.5">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-bold">{bereich.name}</span>
          {gewaehlt && <HakenIcon width={18} height={18} strokeWidth={3} className="shrink-0" />}
          {modus === 'anzeige' && liste.length > 0 && (
            <span className="bg-mulde text-text2 shrink-0 rounded-full px-1.5 text-xs leading-5 font-semibold tabular-nums">
              {liste.length}
            </span>
          )}
        </span>
        {modus === 'auswahl' && (
          <span className={`text-xs ${gewaehlt ? '' : 'text-text2'}`}>{anzahlText(liste.length)}</span>
        )}
        {chips(liste)}
      </Huelle>
    );
  }

  const heimatlos = artikelIn(OHNE_BEREICH);

  return (
    <div className="border-truhe-rand bg-truhe rounded-[1.6rem] border-[3px] p-1.5 sm:p-3">
      <div className="flex flex-col gap-1.5 sm:gap-3">
        {struktur.koerbe.length > 0 && (
          <section aria-label="Hängekörbe">
            <h3 className="text-text2 mb-1 px-1.5 text-[11px] font-bold tracking-wider uppercase">Hängekörbe</h3>
            <div
              className={`grid gap-1.5 sm:gap-2 ${KORB_SPALTEN[struktur.koerbe.length] ?? 'grid-cols-2 sm:grid-cols-3'}`}
            >
              {struktur.koerbe.map((k) => kachel(k, 'korb'))}
            </div>
          </section>
        )}

        {struktur.ebenen.map(({ ebene, faecher }) => {
          if (faecher.length === 0) return kachel(ebene, 'ebene');
          const direkt = artikelIn(ebene.id);
          const gesamt = direkt.length + faecher.reduce((n, f) => n + artikelIn(f.id).length, 0);
          const gewaehlt = modus === 'auswahl' && ausgewaehlt === ebene.id;
          return (
            <section key={ebene.id} aria-label={ebene.name} className="border-rand bg-mulde rounded-[1.1rem] border p-1 sm:p-1.5">
              <Huelle
                {...huelle(ebene.id)}
                className={`mb-1 flex min-h-11 w-full items-center gap-1.5 rounded-xl px-1.5 ${
                  gewaehlt ? 'bg-akzent text-akzent-text' : ''
                } ${hervorgehoben && !hervorgehoben.has(ebene.id) && !gewaehlt ? 'opacity-60' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{ebene.name}</span>
                {modus === 'auswahl' && (
                  <span className={`text-xs ${gewaehlt ? '' : 'text-text2'}`}>
                    {gewaehlt ? 'ohne Fach' : 'ganze Ebene'}
                  </span>
                )}
                {gewaehlt && <HakenIcon width={18} height={18} strokeWidth={3} className="shrink-0" />}
                {modus === 'anzeige' && (
                  <>
                    <span className="text-text2 text-xs font-medium">{anzahlText(gesamt)}</span>
                    <WeiterIcon width={16} height={16} className="text-text2 shrink-0" />
                  </>
                )}
              </Huelle>
              {modus === 'anzeige' && direkt.length > 0 && <div className="mb-1.5 px-1">{chips(direkt)}</div>}
              <div className={`grid gap-1 sm:gap-1.5 ${FACH_SPALTEN[fachSpalten(faecher.length)] ?? 'grid-cols-3'}`}>
                {faecher.map((f) => kachel(f, 'fach'))}
              </div>
            </section>
          );
        })}

        {modus === 'anzeige' && heimatlos.length > 0 && (
          <Huelle
            {...huelle(OHNE_BEREICH)}
            className="border-bald-rand bg-karte flex w-full flex-col gap-1.5 rounded-2xl border-2 border-dotted p-2.5"
          >
            <span className="text-sm font-bold">Nicht zugeordnet</span>
            {chips(heimatlos)}
          </Huelle>
        )}
      </div>
      {/* Griff an der Vorderseite – die Truhe ist von oben gesehen */}
      <div className="bg-truhe-rand mx-auto mt-2.5 h-1.5 w-16 rounded-full" aria-hidden="true" />
    </div>
  );
}
