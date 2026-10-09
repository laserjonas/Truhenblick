import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Meldung {
  text: string;
  /** z. B. „Rückgängig“ */
  aktion?: { name: string; ausfuehren: () => void | Promise<void> };
}

type Zeige = (meldung: Meldung) => void;

const SnackbarContext = createContext<Zeige | null>(null);

export function useSnackbar(): Zeige {
  const zeige = useContext(SnackbarContext);
  if (!zeige) throw new Error('useSnackbar außerhalb des SnackbarProvider verwendet');
  return zeige;
}

const DAUER_MS = 3500;
const DAUER_MIT_AKTION_MS = 7000;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [aktuell, setAktuell] = useState<(Meldung & { nr: number }) | null>(null);
  const zaehler = useRef(0);

  const zeige = useCallback<Zeige>((meldung) => {
    zaehler.current += 1;
    setAktuell({ ...meldung, nr: zaehler.current });
  }, []);

  useEffect(() => {
    if (!aktuell) return;
    const timer = setTimeout(() => setAktuell(null), aktuell.aktion ? DAUER_MIT_AKTION_MS : DAUER_MS);
    return () => clearTimeout(timer);
  }, [aktuell]);

  const wert = useMemo(() => zeige, [zeige]);

  return (
    <SnackbarContext.Provider value={wert}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-3"
        role="status"
        aria-live="polite"
      >
        {aktuell && (
          <div
            key={aktuell.nr}
            className="bg-text text-grund pointer-events-auto flex max-w-md min-w-0 items-center gap-2 rounded-2xl py-1.5 pr-1.5 pl-4 shadow-lg"
          >
            <span className="min-w-0 flex-1 py-2 text-[15px] leading-snug">{aktuell.text}</span>
            {aktuell.aktion && (
              <button
                type="button"
                className="text-grund min-h-11 shrink-0 rounded-xl px-3 font-bold underline underline-offset-4"
                onClick={() => {
                  void aktuell.aktion?.ausfuehren();
                  setAktuell(null);
                }}
              >
                {aktuell.aktion.name}
              </button>
            )}
          </div>
        )}
      </div>
    </SnackbarContext.Provider>
  );
}
