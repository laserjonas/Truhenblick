import { useState } from 'react';
import { datumAnzeige, heuteIso } from '../logic/datum.ts';
import { gleicheAb, neuerCode, setzeCode, trenne, useSyncStatus, verbinde } from '../sync/auto.ts';
import { gespeicherterCode, normalisiereUrl, SyncFehler } from '../sync/client.ts';

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

function meldung(fehler: unknown, sonst: string): string {
  return fehler instanceof SyncFehler ? fehler.message : sonst;
}

function Fehlerkasten({ text }: { text: string }) {
  return (
    <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
      {text}
    </p>
  );
}

/** Eingabefeld für den Zugangscode mit Knopf zum Ein- und Ausblenden. */
function CodeFeld({ id, wert, onChange }: { id: string; wert: string; onChange: (wert: string) => void }) {
  const [sichtbar, setSichtbar] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="feld min-w-0 flex-1"
        type={sichtbar ? 'text' : 'password'}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={wert}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="knopf knopf-leise px-3 text-sm" aria-pressed={sichtbar} onClick={() => setSichtbar(!sichtbar)}>
        {sichtbar ? 'Verbergen' : 'Anzeigen'}
      </button>
    </div>
  );
}

/** Zeigt den Zugangscode groß und gut abtippbar, auf Wunsch mit Kopieren. */
function CodeAnzeige({ code }: { code: string }) {
  const [kopiert, setKopiert] = useState(false);
  // Die Zwischenablage gibt es nur über https (oder localhost) – sonst bleibt das Markieren von Hand.
  const kannKopieren = typeof navigator.clipboard?.writeText === 'function';

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(code);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    } catch {
      setKopiert(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <output
        className="border-rand bg-mulde block rounded-2xl border px-3 py-3 text-center font-mono text-lg font-semibold tracking-wide break-all select-all"
        aria-label="Zugangscode"
      >
        {code}
      </output>
      {kannKopieren && (
        <button type="button" className="knopf knopf-leise" onClick={() => void kopieren()}>
          {kopiert ? '✓ Kopiert' : 'Code kopieren'}
        </button>
      )}
    </div>
  );
}

/** Verbundenes Gerät: Code für weitere Geräte anzeigen oder einen neuen erzeugen. */
function Zugangscode() {
  const [code, setCode] = useState<string | null>(null);
  const [neu, setNeu] = useState(false);
  const [rueckfrage, setRueckfrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function anzeigen() {
    setFehler(null);
    setNeu(false);
    setCode(await gespeicherterCode());
  }

  async function erzeugen() {
    setLaeuft(true);
    setFehler(null);
    try {
      setCode(await neuerCode());
      setNeu(true);
      setRueckfrage(false);
    } catch (e) {
      setFehler(meldung(e, 'Der neue Code konnte nicht erzeugt werden.'));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="border-rand flex flex-col gap-3 border-t pt-4" aria-labelledby="zugangscode-titel">
      <div>
        <h3 id="zugangscode-titel" className="font-bold">
          Zugangscode
        </h3>
        <p className="text-text2 text-sm">Mit diesem Code verbindest du weitere Geräte mit eurem Server.</p>
      </div>

      {code !== null && (
        <>
          {neu && (
            <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
              <strong>Neuer Code erzeugt.</strong> Der bisherige gilt nicht mehr – trage den neuen jetzt auf deinen
              anderen Geräten ein (dort unter Einstellungen → Abgleich zwischen Geräten).
            </p>
          )}
          <CodeAnzeige code={code} />
        </>
      )}

      {fehler && <Fehlerkasten text={fehler} />}

      {rueckfrage ? (
        <div className="border-bald-rand bg-bald-bg text-bald-text flex flex-col gap-2 rounded-2xl border p-3" role="group" aria-label="Neuen Code erzeugen">
          <p className="text-sm font-medium">
            Der bisherige Code gilt danach sofort nicht mehr. Alle anderen Geräte gleichen erst wieder ab, wenn du
            dort den neuen Code eingegeben hast. Ihre Daten bleiben erhalten.
          </p>
          <button type="button" className="knopf knopf-primaer" disabled={laeuft} onClick={() => void erzeugen()}>
            {laeuft ? 'Erzeuge …' : 'Ja, neuen Code erzeugen'}
          </button>
          <button type="button" className="knopf knopf-leise" disabled={laeuft} onClick={() => setRueckfrage(false)}>
            Abbrechen
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {code === null ? (
            <button type="button" className="knopf knopf-leise sm:flex-1" onClick={() => void anzeigen()}>
              Code anzeigen
            </button>
          ) : (
            <button
              type="button"
              className="knopf knopf-leise sm:flex-1"
              onClick={() => {
                setCode(null);
                setNeu(false);
              }}
            >
              Code verbergen
            </button>
          )}
          <button type="button" className="knopf knopf-leise sm:flex-1" onClick={() => setRueckfrage(true)}>
            Neuen Code erzeugen
          </button>
        </div>
      )}
    </section>
  );
}

/** Der hinterlegte Code gilt nicht mehr (auf einem anderen Gerät wurde ein neuer erzeugt): neuen eingeben. */
function CodeErneutEingeben() {
  const [code, setCode] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function uebernehmen() {
    if (!code.trim()) {
      setFehler('Bitte gib den neuen Zugangscode ein.');
      return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      await setzeCode(code);
    } catch (e) {
      setFehler(meldung(e, 'Der Code konnte nicht geprüft werden.'));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <form
      className="border-ueber-rand bg-ueber-bg flex flex-col gap-3 rounded-2xl border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void uebernehmen();
      }}
    >
      <p className="text-ueber-text text-sm font-medium">
        Der Zugangscode dieses Geräts gilt nicht mehr – vermutlich wurde auf einem anderen Gerät ein neuer erzeugt.
        Gib ihn hier ein; deine Änderungen werden danach wie gewohnt abgeglichen.
      </p>
      <div>
        <label className="beschriftung" htmlFor="sync-code-neu">
          Neuer Zugangscode
        </label>
        <CodeFeld id="sync-code-neu" wert={code} onChange={setCode} />
      </div>
      {fehler && <Fehlerkasten text={fehler} />}
      <button type="submit" className="knopf knopf-primaer" disabled={laeuft}>
        {laeuft ? 'Prüfe …' : 'Code übernehmen'}
      </button>
    </form>
  );
}

/** Verbindung zum Sync-Server einrichten, prüfen und trennen; Zugangscode anzeigen und erneuern. */
export function SyncEinstellungen() {
  const status = useSyncStatus();
  const [url, setUrl] = useState(eigeneAdresse);
  const [code, setCode] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [verbindet, setVerbindet] = useState(false);

  async function verbinden() {
    const adresse = normalisiereUrl(url);
    if (!code.trim()) {
      setFehler('Bitte gib den Zugangscode ein.');
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
      await verbinde({ url: adresse === eigeneAdresse() ? '' : adresse, token: code });
      setCode('');
    } catch (e) {
      setFehler(meldung(e, 'Die Verbindung ist fehlgeschlagen.'));
    } finally {
      setVerbindet(false);
    }
  }

  if (status.zustand !== 'aus' && !verbindet) {
    const codeUngueltig = status.fehlerArt === 'token';
    return (
      <div className="flex flex-col gap-3">
        <p>
          ✓ Verbunden mit <strong className="break-all">{status.url || 'diesem Server'}</strong>
        </p>

        {codeUngueltig ? (
          <CodeErneutEingeben />
        ) : (
          <p className={`text-sm ${status.zustand === 'fehler' ? 'text-gefahr font-medium' : 'text-text2'}`} role="status">
            {status.zustand === 'laeuft' && 'Abgleich läuft …'}
            {status.zustand === 'bereit' && `Zuletzt abgeglichen: ${vorWieLange(status.letzterErfolg)}`}
            {status.zustand === 'fehler' &&
              `${status.fehler ?? 'Der Abgleich ist fehlgeschlagen.'} Zuletzt abgeglichen: ${vorWieLange(status.letzterErfolg)}.`}
          </p>
        )}

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

        {!codeUngueltig && <Zugangscode />}
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
          Zugangscode
        </label>
        <CodeFeld id="sync-token" wert={code} onChange={setCode} />
        <details className="text-text2 mt-1.5 text-sm">
          <summary className="text-akzent inline-flex min-h-11 cursor-pointer items-center font-semibold">
            Woher bekomme ich den Code?
          </summary>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <strong className="text-text">Schon ein Gerät verbunden?</strong> Dort unter Einstellungen → Abgleich
              zwischen Geräten auf „Code anzeigen“ tippen.
            </li>
            <li>
              <strong className="text-text">Erstes Gerät?</strong> Den Code nennt die Installation des Servers am Ende.
              Er steht dort auch in der Datei <code className="whitespace-nowrap">/etc/truhenblick/server.env</code> (bei Docker:{' '}
              <code>SYNC_TOKEN</code> in der <code>.env</code>).
            </li>
          </ul>
        </details>
      </div>
      {fehler && <Fehlerkasten text={fehler} />}
      <button type="submit" className="knopf knopf-primaer" disabled={verbindet}>
        {verbindet ? 'Verbinde …' : 'Verbinden'}
      </button>
    </form>
  );
}
