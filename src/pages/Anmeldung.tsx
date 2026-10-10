import { useState } from 'react';
import { anmelden } from '../sync/anmeldung.ts';
import { SyncFehler } from '../sync/client.ts';

/**
 * Loginmaske: erscheint, wenn der Server ein Passwort verlangt und dieses Gerät nicht angemeldet ist.
 * Geschützt wird der Server – was schon auf dem Gerät liegt, bleibt davon unberührt.
 */
export function Anmeldung() {
  const [passwort, setPasswort] = useState('');
  const [sichtbar, setSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden() {
    if (!passwort) {
      setFehler('Bitte gib das Passwort ein.');
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      await anmelden(passwort);
    } catch (e) {
      setFehler(e instanceof SyncFehler ? e.message : 'Die Anmeldung ist fehlgeschlagen.');
      setLaeuft(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <header>
        <p className="text-4xl" aria-hidden="true">
          ❄️
        </p>
        <h1 className="mt-2 text-2xl font-bold">Truhenblick</h1>
        <p className="text-text2 mt-1">Dieser Server ist mit einem Passwort geschützt. Bitte melde dich an.</p>
      </header>

      <form
        className="karte flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void absenden();
        }}
      >
        {/* Für Passwortmanager: Sie speichern Zugangsdaten nur zusammen mit einem Benutzernamen. */}
        <input type="text" name="username" autoComplete="username" value="truhenblick" readOnly hidden />

        <div>
          <label className="beschriftung" htmlFor="anmelde-passwort">
            Passwort
          </label>
          <div className="flex gap-2">
            <input
              id="anmelde-passwort"
              name="password"
              className="feld min-w-0 flex-1"
              type={sichtbar ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              aria-invalid={fehler !== null}
              aria-describedby={fehler ? 'anmelde-fehler' : undefined}
            />
            <button
              type="button"
              className="knopf knopf-leise shrink-0 px-4 text-sm"
              aria-pressed={sichtbar}
              onClick={() => setSichtbar((s) => !s)}
            >
              {sichtbar ? 'Verbergen' : 'Anzeigen'}
            </button>
          </div>
        </div>

        {fehler && (
          <p id="anmelde-fehler" className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
            {fehler}
          </p>
        )}

        <button type="submit" className="knopf knopf-primaer" disabled={laeuft}>
          {laeuft ? 'Melde an …' : 'Anmelden'}
        </button>
      </form>

      <p className="text-text2 text-center text-sm">
        Das Passwort hat festgelegt, wer diesen Server eingerichtet hat. Dieses Gerät bleibt danach angemeldet.
      </p>
    </main>
  );
}
