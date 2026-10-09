import { useEffect, type ReactNode } from 'react';
import { zurueck } from '../hooks/useRoute.ts';
import { ZurueckIcon } from './Icons.tsx';

interface Props {
  titel: string;
  untertitel?: string;
  children: ReactNode;
  /** Feste Knopfleiste am unteren Rand */
  fuss?: ReactNode;
}

/** Bildschirmfüllende Unterseite mit Zurück-Knopf (Bereich, Artikel). */
export function Blatt({ titel, untertitel, children, fuss }: Props) {
  useEffect(() => {
    const vorher = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') zurueck();
    };
    window.addEventListener('keydown', taste);
    return () => {
      document.body.style.overflow = vorher;
      window.removeEventListener('keydown', taste);
    };
  }, []);

  return (
    <div className="bg-grund fixed inset-0 z-40 flex flex-col" role="dialog" aria-modal="true" aria-label={titel}>
      <header className="border-rand bg-karte border-b pt-[env(safe-area-inset-top,0px)]">
        <div className="mx-auto flex max-w-2xl items-center gap-1 px-1.5">
          <button type="button" className="rund" aria-label="Zurück" onClick={zurueck}>
            <ZurueckIcon />
          </button>
          <div className="min-w-0 flex-1 py-2.5">
            <h1 className="truncate text-lg leading-6 font-bold">{titel}</h1>
            {untertitel && <p className="text-text2 truncate text-sm">{untertitel}</p>}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl p-3">{children}</div>
      </div>
      {fuss && (
        <footer className="border-rand bg-karte border-t px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto flex max-w-2xl gap-2">{fuss}</div>
        </footer>
      )}
    </div>
  );
}
