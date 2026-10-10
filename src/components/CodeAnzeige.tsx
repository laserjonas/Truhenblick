import { useState } from 'react';

/** Zeigt den Zugangscode groß und gut abtippbar, auf Wunsch mit Kopieren. */
export function CodeAnzeige({ code }: { code: string }) {
  const [kopiert, setKopiert] = useState(false);
  // Die Zwischenablage gibt es nur über https (oder localhost) – sonst bleibt das Markieren von Hand.
  const kannKopieren = typeof navigator.clipboard?.writeText === 'function';

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(code);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    } catch {
      setKopiert(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <output
        className="border-rand bg-mulde text-text block rounded-2xl border px-3 py-3 text-center font-mono text-lg font-semibold tracking-wide break-all select-all"
        aria-label="Zugangscode"
      >
        {code}
      </output>
      {kannKopieren && (
        <button type="button" className="knopf knopf-leise" onClick={() => void kopieren()}>
          {kopiert ? '✓ Kopiert' : 'Code kopieren'}
        </button>
      )}
    </div>
  );
}

/** Eingabefeld für den Zugangscode mit Knopf zum Ein- und Ausblenden. */
export function CodeFeld({
  id,
  wert,
  onChange,
  platzhalter,
}: {
  id: string;
  wert: string;
  onChange: (wert: string) => void;
  platzhalter?: string;
}) {
  const [sichtbar, setSichtbar] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="feld min-w-0 flex-1"
        type={sichtbar ? 'text' : 'password'}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={platzhalter}
        value={wert}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="knopf knopf-leise px-3 text-sm" aria-pressed={sichtbar} onClick={() => setSichtbar(!sichtbar)}>
        {sichtbar ? 'Verbergen' : 'Anzeigen'}
      </button>
    </div>
  );
}
