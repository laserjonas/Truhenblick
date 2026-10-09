import { MinusIcon, PlusIcon } from './Icons.tsx';

interface Props {
  name: string;
  hinweis?: string;
  wert: number;
  min: number;
  max: number;
  onChange: (wert: number) => void;
  /** Anzeige statt der blanken Zahl, z. B. „keine“ */
  anzeige?: (wert: number) => string;
}

/** Zeile mit Beschriftung und großem −/+ für eine kleine ganze Zahl. */
export function Zahlwaehler({ name, hinweis, wert, min, max, onChange, anzeige }: Props) {
  return (
    <div className="karte flex items-center gap-1 p-1.5 pl-4">
      <div className="min-w-0 flex-1 py-1">
        <div className="font-semibold">{name}</div>
        {hinweis && <div className="text-text2 text-sm">{hinweis}</div>}
      </div>
      <button
        type="button"
        className="rund border-rand border"
        aria-label={`${name}: weniger`}
        disabled={wert <= min}
        onClick={() => onChange(wert - 1)}
      >
        <MinusIcon />
      </button>
      <output className="min-w-14 text-center text-lg font-bold tabular-nums" aria-live="polite">
        {anzeige ? anzeige(wert) : wert}
      </output>
      <button
        type="button"
        className="rund border-rand border"
        aria-label={`${name}: mehr`}
        disabled={wert >= max}
        onClick={() => onChange(wert + 1)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
