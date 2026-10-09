import { useMemo, useState } from 'react';
import type { Bereich } from '../../shared/types.ts';
import { TruhenGrafik } from '../components/TruhenGrafik.tsx';
import { Zahlwaehler } from '../components/Zahlwaehler.tsx';
import { truheEinrichten } from '../db/repo.ts';
import { baueStruktur, standardBereiche, type TruhenKonfig } from '../logic/truhe.ts';
import { SyncEinstellungen } from './SyncEinstellungen.tsx';

/** Baut aus dem Entwurf Bereiche mit Platzhalter-IDs für die Vorschau. */
function vorschauBereiche(konfig: TruhenKonfig): Bereich[] {
  return standardBereiche(konfig).map((e, i) => ({
    id: e.typ === 'ebene' ? `ebene-${e.reihenfolge}` : `${e.typ}-${i}`,
    name: e.name,
    typ: e.typ,
    reihenfolge: e.reihenfolge,
    parentId: e.ebeneIndex === null ? null : `ebene-${e.ebeneIndex}`,
    geaendertAm: '',
    geloeschtAm: null,
  }));
}

/** Erster Start: Aufbau der Truhe abfragen und anlegen. */
export function Einrichtung() {
  const [koerbe, setKoerbe] = useState(2);
  const [ebenen, setEbenen] = useState(2);
  const [faecher, setFaecher] = useState(1);
  const [speichert, setSpeichert] = useState(false);

  const konfig = useMemo<TruhenKonfig>(
    () => ({ koerbe, ebenen, faecherJeEbene: faecher }),
    [koerbe, ebenen, faecher],
  );
  const struktur = useMemo(() => baueStruktur(vorschauBereiche(konfig)), [konfig]);

  async function anlegen() {
    setSpeichert(true);
    try {
      await truheEinrichten(konfig);
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <header>
        <p className="text-4xl" aria-hidden="true">
          ❄️
        </p>
        <h1 className="mt-2 text-2xl font-bold">Willkommen bei Truhenblick</h1>
        <p className="text-text2 mt-1">
          Wie ist deine Gefriertruhe aufgebaut? Namen und Aufteilung kannst du später jederzeit in den Einstellungen
          ändern.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <Zahlwaehler
          name="Hängekörbe"
          hinweis="oben eingehängt"
          wert={koerbe}
          min={0}
          max={6}
          onChange={setKoerbe}
          anzeige={(n) => (n === 0 ? 'keine' : String(n))}
        />
        <Zahlwaehler name="Ebenen" hinweis="Schichten darunter, bis zum Boden" wert={ebenen} min={1} max={6} onChange={setEbenen} />
        <Zahlwaehler
          name="Fächer je Ebene"
          hinweis="z. B. links / rechts"
          wert={faecher}
          min={1}
          max={6}
          onChange={setFaecher}
          anzeige={(n) => (n === 1 ? 'keine' : String(n))}
        />
      </div>

      <section aria-label="Vorschau">
        <h2 className="text-text2 mb-1.5 text-sm font-medium">So sieht deine Truhe von oben aus</h2>
        <TruhenGrafik struktur={struktur} modus="vorschau" />
      </section>

      <button type="button" className="knopf knopf-primaer mt-auto w-full" disabled={speichert} onClick={() => void anlegen()}>
        Truhe anlegen
      </button>

      <details className="karte group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
          Schon eine Truhe auf einem anderen Gerät?
        </summary>
        <div className="border-rand border-t p-4">
          <p className="text-text2 mb-3 text-sm">
            Verbinde dieses Gerät mit eurem Truhenblick-Server – die vorhandene Truhe erscheint dann von selbst. Liegt
            dort noch keine, lege sie oben an.
          </p>
          <SyncEinstellungen />
        </div>
      </details>
    </main>
  );
}
