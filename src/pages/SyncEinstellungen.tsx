import { useState } from 'react';
import { datumAnzeige, heuteIso } from '../logic/datum.ts';
import { gleicheAb, trenne, useSyncStatus, verbinde } from '../sync/auto.ts';
import { normalisiereUrl, SyncFehler } from '../sync/client.ts';

function eigeneAdresse(): string {
  return /^https?:$/.test(window.location.protocol) ? window.location.origin : '';
}

/** „gerade eben“, „vor 5 Min.“, „vor 3 Std.“, sonst das Datum */
function vorWieLange(iso: string | null): string {
  if (!iso) return 'noch nie';
  const minuten = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minuten < 1) return 'gerade eben';
  if (minuten < 60) return `vor ${minuten} Min.`;
  if (minuten < 24 * 60) return `vor ${Math.floor(minuten / 60)} Std.`;
  return `am ${datumAnzeige(heuteIso(new Date(iso)))}`;
}

/** Verbindung zum Sync-Server einrichten, prüfen und trennen. */
export function SyncEinstellungen() {
  const status = useSyncStatus();
  const [url, setUrl] = useState(eigeneAdresse);
  const [token, setToken] = useState('');
  const [tokenSichtbar, setTokenSichtbar] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [verbindet, setVerbindet] = useState(false);

  async function verbinden() {
    const adresse = normalisiereUrl(url);
    if (!token.trim()) {
      setFehler('Bitte gib das Zugangs-Token ein.');
      return;
    }
    if (window.location.protocol === 'https:' && adresse.startsWith('http://')) {
      setFehler('Diese Seite läuft über https – der Server muss dann ebenfalls über https:// erreichbar sein.');
      return;
    }
    setFehler(null);
    setVerbindet(true);
    try {
      // Kommt die App vom Sync-Server selbst, bleibt die Adresse relativ – dann darf sich dessen Name ändern.
      await verbinde({ url: adresse === eigeneAdresse() ? '' : adresse, token });
      setToken('');
    } catch (e) {
      setFehler(e instanceof SyncFehler ? e.message : 'Die Verbindung ist fehlgeschlagen.');
    } finally {
      setVerbindet(false);
    }
  }

  if (status.zustand !== 'aus' && !verbindet) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          ✓ Verbunden mit <strong className="break-all">{status.url || 'diesem Server'}</strong>
        </p>
        <p
          className={`text-sm ${status.zustand === 'fehler' ? 'text-gefahr font-medium' : 'text-text2'}`}
          role="status"
        >
          {status.zustand === 'laeuft' && 'Abgleich läuft …'}
          {status.zustand === 'bereit' && `Zuletzt abgeglichen: ${vorWieLange(status.letzterErfolg)}`}
          {status.zustand === 'fehler' &&
            `${status.fehler ?? 'Der Abgleich ist fehlgeschlagen.'} Zuletzt abgeglichen: ${vorWieLange(status.letzterErfolg)}.`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="knopf knopf-leise sm:flex-1"
            disabled={status.zustand === 'laeuft'}
            onClick={() => void gleicheAb()}
          >
            Jetzt abgleichen
          </button>
          <button type="button" className="knopf knopf-gefahr sm:flex-1" onClick={() => void trenne()}>
            Verbindung trennen
          </button>
        </div>
        <p className="text-text2 text-sm">Beim Trennen bleiben alle Daten auf diesem Gerät erhalten.</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void verbinden();
      }}
    >
      <div>
        <label className="beschriftung" htmlFor="sync-url">
          Adresse des Servers
        </label>
        <input
          id="sync-url"
          className="feld"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://truhe.example.de"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div>
        <label className="beschriftung" htmlFor="sync-token">
          Zugangs-Token
        </label>
        <div className="flex gap-2">
          <input
            id="sync-token"
            className="feld min-w-0 flex-1"
            type={tokenSichtbar ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            type="button"
            className="knopf knopf-leise px-3 text-sm"
            aria-pressed={tokenSichtbar}
            onClick={() => setTokenSichtbar(!tokenSichtbar)}
          >
            {tokenSichtbar ? 'Verbergen' : 'Anzeigen'}
          </button>
        </div>
      </div>
      {fehler && (
        <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
          {fehler}
        </p>
      )}
      <button type="submit" className="knopf knopf-primaer" disabled={verbindet}>
        {verbindet ? 'Verbinde …' : 'Verbinden'}
      </button>
    </form>
  );
}
