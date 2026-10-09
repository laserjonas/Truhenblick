import { SchliessenIcon, SucheIcon } from './Icons.tsx';

interface Props {
  wert: string;
  onChange: (wert: string) => void;
}

export function Suchleiste({ wert, onChange }: Props) {
  return (
    <div className="relative flex-1">
      <SucheIcon className="text-text2 pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2" width={20} height={20} />
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        className="feld px-11 [&::-webkit-search-cancel-button]:hidden"
        placeholder="Was suchst du?"
        aria-label="Artikel suchen"
        value={wert}
        onChange={(e) => onChange(e.target.value)}
      />
      {wert && (
        <button
          type="button"
          className="rund absolute top-1/2 right-0.5 -translate-y-1/2"
          aria-label="Suche leeren"
          onClick={() => onChange('')}
        >
          <SchliessenIcon width={20} height={20} />
        </button>
      )}
    </div>
  );
}
