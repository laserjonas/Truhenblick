import type { ReactNode } from 'react';
import { TruheBearbeiten } from './TruheBearbeiten.tsx';

export function Abschnitt({ titel, hinweis, children }: { titel: string; hinweis?: string; children: ReactNode }) {
  return (
    <section className="karte p-4">
      <h2 className="text-lg font-bold">{titel}</h2>
      {hinweis && <p className="text-text2 mt-0.5 mb-3 text-sm">{hinweis}</p>}
      <div className={hinweis ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

export function Einstellungen() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-3 px-3 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-28">
      <h1 className="px-1 text-2xl font-bold">Einstellungen</h1>

      <Abschnitt
        titel="Truhe bearbeiten"
        hinweis="Tippe auf einen Namen, um ihn zu ändern. Bereiche lassen sich nur löschen, wenn sie leer sind."
      >
        <TruheBearbeiten />
      </Abschnitt>

      <p className="text-text2 px-1 text-center text-sm">Truhenblick {__APP_VERSION__}</p>
    </main>
  );
}
