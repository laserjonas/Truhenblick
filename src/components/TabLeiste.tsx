import type { ReactNode } from 'react';
import { ersetze, type Reiter } from '../hooks/useRoute.ts';
import { ListeIcon, TruheIcon, UhrIcon, ZahnradIcon } from './Icons.tsx';

interface Eintrag {
  reiter: Reiter;
  name: string;
  pfad: string;
  icon: ReactNode;
}

const EINTRAEGE: Eintrag[] = [
  { reiter: 'truhe', name: 'Truhe', pfad: '/', icon: <TruheIcon /> },
  { reiter: 'liste', name: 'Liste', pfad: '/liste', icon: <ListeIcon /> },
  { reiter: 'bald', name: 'Bald fällig', pfad: '/bald', icon: <UhrIcon /> },
  { reiter: 'einstellungen', name: 'Einstellungen', pfad: '/einstellungen', icon: <ZahnradIcon /> },
];

interface Props {
  aktiv: Reiter;
  /** Anzahl überfälliger und bald fälliger Artikel – als Zähler am Reiter */
  faellig: number;
  /** Mindestens ein Artikel ist überfällig */
  ueberfaellig: boolean;
}

export function TabLeiste({ aktiv, faellig, ueberfaellig }: Props) {
  return (
    <nav
      className="border-rand bg-karte fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Hauptnavigation"
    >
      <div className="mx-auto flex max-w-2xl">
        {EINTRAEGE.map((e) => {
          const zaehler = e.reiter === 'bald' && faellig > 0;
          return (
            <button
              key={e.reiter}
              type="button"
              className={`flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold sm:text-xs ${
                aktiv === e.reiter ? 'text-akzent' : 'text-text2'
              }`}
              aria-current={aktiv === e.reiter ? 'page' : undefined}
              onClick={() => ersetze(e.pfad)}
            >
              <span className={`relative rounded-full px-4 py-0.5 ${aktiv === e.reiter ? 'bg-akzent-weich' : ''}`}>
                {e.icon}
                {zaehler && (
                  <span
                    aria-hidden="true"
                    className={`absolute -top-1 right-0.5 min-w-5 rounded-full border px-1 text-center text-[11px] leading-[1.125rem] font-bold tabular-nums ${
                      ueberfaellig
                        ? 'border-ueber-rand bg-ueber-bg text-ueber-text'
                        : 'border-bald-rand bg-bald-bg text-bald-text'
                    }`}
                  >
                    {faellig}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-0.5">
                {e.name}
                {zaehler && <span className="sr-only">, {faellig} Artikel</span>}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
