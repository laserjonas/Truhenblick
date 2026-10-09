import type { ReactNode } from 'react';
import { ersetze, type Reiter } from '../hooks/useRoute.ts';
import { TruheIcon, ZahnradIcon } from './Icons.tsx';

interface Eintrag {
  reiter: Reiter;
  name: string;
  pfad: string;
  icon: ReactNode;
}

const EINTRAEGE: Eintrag[] = [
  { reiter: 'truhe', name: 'Truhe', pfad: '/', icon: <TruheIcon /> },
  { reiter: 'einstellungen', name: 'Einstellungen', pfad: '/einstellungen', icon: <ZahnradIcon /> },
];

export function TabLeiste({ aktiv }: { aktiv: Reiter }) {
  return (
    <nav
      className="border-rand bg-karte fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Hauptnavigation"
    >
      <div className="mx-auto flex max-w-2xl">
        {EINTRAEGE.map((e) => (
          <button
            key={e.reiter}
            type="button"
            className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
              aktiv === e.reiter ? 'text-akzent' : 'text-text2'
            }`}
            aria-current={aktiv === e.reiter ? 'page' : undefined}
            onClick={() => ersetze(e.pfad)}
          >
            <span className={`rounded-full px-4 py-0.5 ${aktiv === e.reiter ? 'bg-akzent-weich' : ''}`}>{e.icon}</span>
            {e.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
