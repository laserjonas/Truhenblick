import { useState } from 'react';
import { PlusIcon } from './components/Icons.tsx';
import { SnackbarProvider } from './components/Snackbar.tsx';
import { TabLeiste } from './components/TabLeiste.tsx';
import { DatenProvider, useDaten, useGeladeneDaten } from './hooks/useDaten.tsx';
import { gehe, useRoute, type Reiter, type Route } from './hooks/useRoute.ts';
import { ArtikelFormular } from './pages/ArtikelFormular.tsx';
import { BereichDetail } from './pages/BereichDetail.tsx';
import { Blatt } from './components/Blatt.tsx';
import { Einrichtung } from './pages/Einrichtung.tsx';
import { Einstellungen } from './pages/Einstellungen.tsx';
import { TruhePage } from './pages/TruhePage.tsx';

function istReiter(route: Route): route is { seite: Reiter } {
  return route.seite !== 'bereich' && route.seite !== 'neu' && route.seite !== 'artikel';
}

export function App() {
  const daten = useGeladeneDaten();

  // IndexedDB antwortet in Millisekunden – bis dahin bleibt der Hintergrund stehen, ohne Ladeanzeige.
  if (!daten) return null;
  if (daten.bereiche.length === 0) return <Einrichtung />;

  return (
    <DatenProvider daten={daten}>
      <SnackbarProvider>
        <Hauptansicht />
      </SnackbarProvider>
    </DatenProvider>
  );
}

function Hauptansicht() {
  const route = useRoute();
  const [reiter, setReiter] = useState<Reiter>(istReiter(route) ? route.seite : 'truhe');
  const [suche, setSuche] = useState('');
  const [kategorie, setKategorie] = useState<string | null>(null);

  // Unterseiten liegen über dem zuletzt gezeigten Reiter.
  if (istReiter(route) && route.seite !== reiter) setReiter(route.seite);
  const unterseite = !istReiter(route);

  return (
    <>
      <div inert={unterseite}>
        {reiter === 'einstellungen' ? (
          <Einstellungen />
        ) : (
          <TruhePage suche={suche} setSuche={setSuche} kategorie={kategorie} setKategorie={setKategorie} />
        )}

        {reiter !== 'einstellungen' && (
          <button
            type="button"
            className="knopf knopf-primaer fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-30 min-h-14 rounded-full pr-6 pl-5 text-lg shadow-lg"
            onClick={() => gehe('/neu')}
          >
            <PlusIcon strokeWidth={2.6} />
            Artikel
          </button>
        )}
        <TabLeiste aktiv={reiter} />
      </div>

      {unterseite && <Unterseite route={route} />}
    </>
  );
}

function Unterseite({ route }: { route: Route }) {
  const { artikel } = useDaten();

  if (route.seite === 'bereich') return <BereichDetail key={route.id} id={route.id} />;
  if (route.seite === 'neu') return <ArtikelFormular key="neu" artikel={null} startBereichId={route.bereichId} />;
  if (route.seite === 'artikel') {
    const gefunden = artikel.find((a) => a.id === route.id);
    if (gefunden) return <ArtikelFormular key={gefunden.id} artikel={gefunden} startBereichId={null} />;
    return (
      <Blatt titel="Artikel nicht gefunden">
        <p className="text-text2 p-6 text-center">Diesen Artikel gibt es nicht mehr – vielleicht wurde er entnommen.</p>
      </Blatt>
    );
  }
  return null;
}
