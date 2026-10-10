import { useState } from 'react';
import { installiere, useInstallation } from '../hooks/useInstallation.ts';
import { useAnmeldung } from '../sync/anmeldung.ts';
import { SchliessenIcon } from './Icons.tsx';

const MERKER = 'truhenblick.installhinweis-ausgeblendet';
const MERKER_HTTP = 'truhenblick.httphinweis-ausgeblendet';

function ausgeblendet(merker: string): boolean {
  try {
    return localStorage.getItem(merker) === '1';
  } catch {
    return false;
  }
}

function merke(merker: string): void {
  try {
    localStorage.setItem(merker, '1');
  } catch {
    // Ohne Speicher erscheint der Hinweis beim nächsten Start eben wieder.
  }
}

/**
 * Über http:// gibt es keinen Service Worker: Die App lädt bei jedem Start vom Server und läuft
 * nur, solange der erreichbar ist. Ein Symbol auf dem Home-Bildschirm ändert daran nichts.
 */
export function OhneHttps({ adresse, installiert }: { adresse: string | null; installiert: boolean }) {
  return (
    <>
      Sie wurde über http:// geöffnet und lädt deshalb bei jedem Start vom Server – unterwegs, ohne Verbindung zu
      ihm, startet sie nicht. Ohne Netz läuft sie nur über https://
      {adresse ? (
        <>
          , also unter{' '}
          <a className="font-semibold wrap-anywhere underline" href={`https://${adresse}`}>
            https://{adresse}
          </a>
          .
        </>
      ) : (
        '. Wie der Server so erreichbar wird, steht unter Einstellungen → Server.'
      )}
      {installiert && ' Das Symbol auf dem Home-Bildschirm ist bis dahin nur eine Verknüpfung.'}
    </>
  );
}

/** Das Teilen-Symbol von iOS (Kasten mit Pfeil nach oben). */
export function TeilenSymbol() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-0.5 inline-block align-[-3px]"
      role="img"
      aria-label="Teilen"
    >
      <path d="M12 15V3M8 6.5 12 3l4 3.5M7 10H5.5v10.5h13V10H17" />
    </svg>
  );
}

/** Anleitung für iPhone/iPad, wo es keinen Installationsdialog gibt. */
export function IosAnleitung() {
  return (
    <>
      Tippe in der Browserleiste auf <TeilenSymbol /> <strong>Teilen</strong> und wähle{' '}
      <strong>„Zum Home-Bildschirm“</strong>.
    </>
  );
}

/**
 * Dezente Karte auf der Startseite: bietet die Installation an (Android/Desktop)
 * oder erklärt den Weg über „Teilen“ (iOS). Lässt sich dauerhaft ausblenden.
 */
export function InstallHinweis() {
  const { installiert, angebot, ios, sicher } = useInstallation();
  const adresse = useAnmeldung().server?.adresse ?? null;
  const [weg, setWeg] = useState(() => ausgeblendet(MERKER));
  const [httpWeg, setHttpWeg] = useState(() => ausgeblendet(MERKER_HTTP));

  // Über http:// nicht zur Installation auffordern – sie brächte nicht, was man von ihr erwartet.
  if (!sicher) {
    if (httpWeg) return null;
    return (
      <aside className="border-bald-rand bg-bald-bg text-bald-text flex items-start gap-2 rounded-2xl border py-2 pr-1 pl-4" aria-label="Kein Betrieb ohne Netz">
        <div className="min-w-0 flex-1 py-1.5">
          <p className="font-semibold">Diese App läuft nur mit Verbindung zum Server</p>
          <p className="mt-0.5 text-sm">
            <OhneHttps adresse={adresse} installiert={installiert} />
          </p>
        </div>
        <button
          type="button"
          className="rund"
          aria-label="Hinweis ausblenden"
          onClick={() => {
            setHttpWeg(true);
            merke(MERKER_HTTP);
          }}
        >
          <SchliessenIcon width={20} height={20} />
        </button>
      </aside>
    );
  }

  if (weg || installiert || (!angebot && !ios)) return null;

  function ausblenden() {
    setWeg(true);
    merke(MERKER);
  }

  return (
    <aside className="border-akzent bg-akzent-weich flex items-start gap-2 rounded-2xl border py-2 pr-1 pl-4" aria-label="App installieren">
      <div className="min-w-0 flex-1 py-1.5">
        <p className="font-semibold">Truhenblick auf den Home-Bildschirm legen</p>
        <p className="mt-0.5 text-sm">
          {ios ? <IosAnleitung /> : 'Dann startet die App wie jede andere – auch ohne Internet.'}
        </p>
        {angebot && (
          <button type="button" className="knopf knopf-primaer mt-2 min-h-11 px-4" onClick={() => void installiere()}>
            Installieren
          </button>
        )}
      </div>
      <button type="button" className="rund" aria-label="Hinweis ausblenden" onClick={ausblenden}>
        <SchliessenIcon width={20} height={20} />
      </button>
    </aside>
  );
}
