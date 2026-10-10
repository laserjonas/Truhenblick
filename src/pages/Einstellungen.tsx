import type { ReactNode } from 'react';
import { IosAnleitung, OhneHttps } from '../components/InstallHinweis.tsx';
import { installiere, useInstallation } from '../hooks/useInstallation.ts';
import { useAnmeldung } from '../sync/anmeldung.ts';
import { Aktualisierung } from './Aktualisierung.tsx';
import { Datensicherung } from './Datensicherung.tsx';
import { HomeAssistant } from './HomeAssistant.tsx';
import { ServerEinstellungen } from './ServerEinstellungen.tsx';
import { SyncEinstellungen } from './SyncEinstellungen.tsx';
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

function AppInstallieren() {
  const { installiert, angebot, ios, sicher } = useInstallation();
  // Die in der App eingestellte Adresse des Servers (Einstellungen → Server), falls es eine gibt
  const adresse = useAnmeldung().server?.adresse ?? null;

  // Zuerst: Über http:// ist auch ein Symbol auf dem Home-Bildschirm keine installierte App.
  if (!sicher) {
    return (
      <p>
        <strong>So läuft die App nur mit Verbindung zum Server.</strong> <OhneHttps adresse={adresse} installiert={installiert} />
      </p>
    );
  }
  if (installiert) return <p>✓ Truhenblick ist auf diesem Gerät installiert und startet auch ohne Internet.</p>;
  if (angebot) {
    return (
      <button type="button" className="knopf knopf-primaer w-full" onClick={() => void installiere()}>
        Truhenblick installieren
      </button>
    );
  }
  if (ios) {
    return (
      <p>
        <IosAnleitung />
      </p>
    );
  }
  return (
    <p>
      Öffne das Menü deines Browsers und wähle <strong>„App installieren“</strong> oder{' '}
      <strong>„Zum Startbildschirm hinzufügen“</strong>.
    </p>
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

      <Abschnitt
        titel="Datensicherung"
        hinweis="Alle Daten liegen nur auf diesem Gerät. Ein Backup ist eine JSON-Datei, die du aufbewahren oder auf ein anderes Gerät übertragen kannst."
      >
        <Datensicherung />
      </Abschnitt>

      <Abschnitt
        titel="Abgleich zwischen Geräten"
        hinweis="Optional: Mit einem eigenen Truhenblick-Server sehen alle Geräte im Haushalt denselben Stand. Ohne Server bleibt alles auf diesem Gerät."
      >
        <SyncEinstellungen />
      </Abschnitt>

      <Abschnitt
        titel="Server"
        hinweis="Unter welcher Adresse der Server erreichbar ist – und ob man sich mit einem Passwort anmelden muss."
      >
        <ServerEinstellungen />
      </Abschnitt>

      <Abschnitt
        titel="Home Assistant"
        hinweis="Zeigt im Home-Assistant-Dashboard, was in der Truhe bald abläuft. Dort muss nichts installiert werden."
      >
        <HomeAssistant />
      </Abschnitt>

      <Abschnitt
        titel="Aktualisierung"
        hinweis="Neue Versionen der App laden und – wenn dieses Gerät verbunden ist – den Server aktualisieren."
      >
        <Aktualisierung />
      </Abschnitt>

      <Abschnitt titel="App installieren" hinweis="Als App startet Truhenblick vom Home-Bildschirm und funktioniert auch ohne Internet.">
        <AppInstallieren />
      </Abschnitt>

      <p className="text-text2 px-1 text-center text-sm">Truhenblick {__APP_VERSION__}</p>
    </main>
  );
}
