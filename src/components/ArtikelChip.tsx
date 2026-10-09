import type { Artikel } from '../../shared/types.ts';
import { mengeKurz } from '../config/einheiten.ts';
import { STATUS_NAME, statusVon, type Status } from '../logic/haltbarkeit.ts';
import { StatusSymbol } from './Icons.tsx';

export const STATUS_FLAECHE: Record<Status, string> = {
  frisch: 'bg-frisch-bg text-frisch-text border-frisch-rand',
  bald: 'bg-bald-bg text-bald-text border-bald-rand',
  ueberfaellig: 'bg-ueber-bg text-ueber-text border-ueber-rand',
};

export const STATUS_TEXT: Record<Status, string> = {
  frisch: 'text-frisch-text',
  bald: 'text-bald-text',
  ueberfaellig: 'text-ueber-text',
};

interface Props {
  artikel: Artikel;
  heute: string;
  /** Suchtreffer */
  betont?: boolean;
  /** Kein Suchtreffer, während gesucht wird */
  gedimmt?: boolean;
}

/** Kompakter Artikel in der Truhengrafik: Emoji, Name, Menge – Farbe und Symbol zeigen die Haltbarkeit. */
export function ArtikelChip({ artikel, heute, betont = false, gedimmt = false }: Props) {
  const status = statusVon(artikel, heute);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-[3px] rounded-full border px-1.5 py-0.5 text-[13px] leading-5 font-medium ${STATUS_FLAECHE[status]} ${gedimmt ? 'opacity-35' : ''} ${betont ? 'ring-akzent ring-2' : ''}`}
    >
      {status !== 'frisch' && (
        <StatusSymbol status={status} width={13} height={13} strokeWidth={2.6} className="shrink-0" />
      )}
      <span aria-hidden="true">{artikel.emoji}</span>
      <span className="truncate">{artikel.name}</span>
      <span className="shrink-0 pl-px text-xs tabular-nums opacity-80">{mengeKurz(artikel.menge, artikel.einheit)}</span>
      <span className="sr-only">, {STATUS_NAME[status]}</span>
    </span>
  );
}
