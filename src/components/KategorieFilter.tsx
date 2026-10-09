import { useEffect, useRef } from 'react';
import { KATEGORIEN } from '../config/kategorien.ts';

interface Props {
  /** Gewählte Kategorie-ID oder null */
  wert: string | null;
  onChange: (wert: string | null) => void;
  /** Mit „Alle“ davor: Filter. Ohne: Auswahl genau einer Kategorie. */
  mitAlle?: boolean;
  /** Kategorien, die Artikel enthalten – leere treten im Filter zurück */
  vorhanden?: ReadonlySet<string>;
  beschriftung: string;
}

/** Waagerecht wischbare Reihe von Kategorie-Knöpfen. */
export function KategorieFilter({ wert, onChange, mitAlle = false, vorhanden, beschriftung }: Props) {
  const reihe = useRef<HTMLDivElement>(null);

  // Die gewählte Kategorie in den sichtbaren Teil der Reihe holen (z. B. wenn sie vorgeschlagen wurde).
  useEffect(() => {
    const box = reihe.current;
    const aktiv = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!box || !aktiv) return;
    const links = aktiv.offsetLeft - box.offsetLeft;
    const sichtbar = links >= box.scrollLeft && links + aktiv.offsetWidth <= box.scrollLeft + box.clientWidth;
    if (!sichtbar) box.scrollTo({ left: links - (box.clientWidth - aktiv.offsetWidth) / 2 });
  }, [wert]);

  const knopf = (aktiv: boolean, leer: boolean) =>
    `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap ${
      aktiv ? 'border-akzent bg-akzent text-akzent-text' : `border-rand bg-karte ${leer ? 'text-text2' : 'text-text'}`
    }`;

  return (
    <div
      ref={reihe}
      className="ohne-leiste -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5"
      role="group"
      aria-label={beschriftung}
    >
      {mitAlle && (
        <button type="button" className={knopf(wert === null, false)} aria-pressed={wert === null} onClick={() => onChange(null)}>
          Alle
        </button>
      )}
      {KATEGORIEN.map((k) => (
        <button
          key={k.id}
          type="button"
          className={knopf(wert === k.id, vorhanden ? !vorhanden.has(k.id) : false)}
          aria-pressed={wert === k.id}
          onClick={() => onChange(mitAlle && wert === k.id ? null : k.id)}
        >
          <span aria-hidden="true">{k.emoji}</span>
          {k.name}
        </button>
      ))}
    </div>
  );
}
