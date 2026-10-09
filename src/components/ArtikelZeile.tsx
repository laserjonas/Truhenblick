import type { Artikel } from '../../shared/types.ts';
import { einheitInfo, zahlAnzeige } from '../config/einheiten.ts';
import { useArtikelAktionen } from '../hooks/useArtikelAktionen.ts';
import { useDaten } from '../hooks/useDaten.tsx';
import { gehe } from '../hooks/useRoute.ts';
import { restText, resttage, statusAusResttagen } from '../logic/haltbarkeit.ts';
import { STATUS_TEXT } from './ArtikelChip.tsx';
import { MinusIcon, PlusIcon, StatusSymbol } from './Icons.tsx';

interface Props {
  artikel: Artikel;
  /** Bereich mit anzeigen (in Listen über mehrere Bereiche) */
  zeigeOrt?: boolean;
}

/** Listenzeile: Tipp links öffnet den Artikel, rechts −/+ für die Menge. */
export function ArtikelZeile({ artikel, zeigeOrt = false }: Props) {
  const { heute, ortVon } = useDaten();
  const aktionen = useArtikelAktionen();
  const rest = resttage(artikel, heute);
  const status = statusAusResttagen(rest);
  const einheit = einheitInfo(artikel.einheit);
  const letzter = artikel.menge - einheit.schritt <= 0;

  return (
    <li className="karte flex items-center gap-0.5 p-1">
      <button
        type="button"
        className="active:bg-mulde flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left"
        onClick={() => gehe(`/artikel/${artikel.id}`)}
      >
        <span className="text-2xl leading-none" aria-hidden="true">
          {artikel.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{artikel.name}</span>
          <span className={`flex items-center gap-1 text-sm font-medium ${STATUS_TEXT[status]}`}>
            <StatusSymbol status={status} width={14} height={14} strokeWidth={2.6} className="shrink-0" />
            <span className="truncate">{restText(rest)}</span>
          </span>
          {zeigeOrt && <span className="text-text2 block truncate text-sm">{ortVon(artikel)}</span>}
        </span>
      </button>
      <button
        type="button"
        className="rund"
        aria-label={letzter ? `${artikel.name} entnehmen` : `${artikel.name}: Menge verringern`}
        onClick={() => void aktionen.menge(artikel, -1)}
      >
        <MinusIcon />
      </button>
      <span className="flex min-w-11 flex-col items-center leading-tight" aria-label={`Menge ${zahlAnzeige(artikel.menge)} ${einheit.name}`}>
        <span className="text-lg font-bold tabular-nums">{zahlAnzeige(artikel.menge)}</span>
        <span className="text-text2 text-xs">{einheit.kurz}</span>
      </span>
      <button
        type="button"
        className="rund"
        aria-label={`${artikel.name}: Menge erhöhen`}
        onClick={() => void aktionen.menge(artikel, 1)}
      >
        <PlusIcon />
      </button>
    </li>
  );
}
