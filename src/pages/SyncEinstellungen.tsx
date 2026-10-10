import { useEffect, useState } from 'react';
import { CodeAnzeige, CodeFeld } from '../components/CodeAnzeige.tsx';
import { datumAnzeige, heuteIso } from '../logic/datum.ts';
import { gebeFrei, gleicheAb, neuerCode, setzeCode, trenne, useSyncStatus, verbinde } from '../sync/auto.ts';
import { gespeicherterCode, normalisiereUrl, pruefeServer, SyncFehler, type ServerInfo } from '../sync/client.ts';

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

/** Verbundenes Gerät: Code für weitere Geräte anzeigen oder einen neuen erzeugen. */
function Zugangscode({ frischFreigegeben }: { frischFreigegeben: string | null }) {
  const [code, setCode] = useState<string | null>(frischFreigegeben);
  const [hinweis, setHinweis] = useState<'freigegeben' | 'neu' | null>(frischFreigegeben ? 'freigegeben' : null);
  const [rueckfrage, setRueckfrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function anzeigen() {
    setFehler(null);
    setHinweis(null);
    setCode(await gespeicherterCode());
  }

  async function erzeugen() {
    setLaeuft(true);
    setFehler(null);
    try {
      setCode(await neuerCode());
      setHinweis('neu');
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
        <p className="text-text2 text-sm">
          Mit diesem Code treten weitere Geräte eurer Truhe bei – dort beim ersten Start „Einer Truhe beitreten“ wählen.
        </p>
      </div>

      {code !== null && (
        <>
          {hinweis === 'freigegeben' && (
            <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
              <strong>✓ Die Truhe ist freigegeben.</strong> Gib diesen Code auf deinen anderen Geräten ein.
            </p>
          )}
          {hinweis === 'neu' && (
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
                setHinweis(null);
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

/** Trennen mit Rückfrage – danach kennt dieses Gerät den Code nicht mehr. */
function Trennen() {
  const [code, setCode] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);

  async function fragen() {
    setCode(await gespeicherterCode());
    setOffen(true);
  }

  if (!offen) {
    return (
      <button type="button" className="knopf knopf-gefahr sm:flex-1" onClick={() => void fragen()}>
        Verbindung trennen
      </button>
    );
  }
  return (
    <div className="border-bald-rand bg-bald-bg text-bald-text flex w-full flex-col gap-2 rounded-2xl border p-3" role="group" aria-label="Verbindung trennen">
      <p className="text-sm font-medium">
        Dieses Gerät vergisst dabei den Zugangscode. Notiere ihn, wenn du später wieder beitreten möchtest – die
        Truhe bleibt auf dem Server, deine Daten bleiben auf diesem Gerät.
      </p>
      {code && <CodeAnzeige code={code} />}
      <button type="button" className="knopf knopf-gefahr" onClick={() => void trenne()}>
        Ja, trennen
      </button>
      <button type="button" className="knopf knopf-leise" onClick={() => setOffen(false)}>
        Abbrechen
      </button>
    </div>
  );
}

/**
 * Abgleich zwischen Geräten: die eigene Truhe freigeben (dabei entsteht der Code),
 * einer vorhandenen beitreten, den Code anzeigen und erneuern, trennen.
 */
export function SyncEinstellungen() {
  const status = useSyncStatus();
  const [adresse, setAdresse] = useState(eigeneAdresse);
  const [code, setCode] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<'freigeben' | 'beitreten' | null>(null);
  const [frischFreigegeben, setFrischFreigegeben] = useState<string | null>(null);
  // Liefert der Server, von dem die App kommt, auch den Abgleich? null = wird noch geprüft.
  const [server, setServer] = useState<ServerInfo | null>(null);

  const verbunden = status.zustand !== 'aus';
  useEffect(() => {
    if (verbunden) return;
    let aktuell = true;
    void pruefeServer('').then((info) => {
      if (aktuell) setServer(info);
    });
    return () => {
      aktuell = false;
    };
  }, [verbunden]);

  /** Normalisierte Zieladresse; leer = der Server, von dem die App kommt. */
  function ziel(): string | null {
    const norm = normalisiereUrl(adresse);
    if (window.location.protocol === 'https:' && norm.startsWith('http://')) {
      setFehler('Diese Seite läuft über https – der Server muss dann ebenfalls über https:// erreichbar sein.');
      return null;
    }
    // Kommt die App vom Sync-Server selbst, bleibt die Adresse relativ – dann darf sich dessen Name ändern.
    return norm === eigeneAdresse() ? '' : norm;
  }

  async function freigeben() {
    const url = ziel();
    if (url === null) return;
    setFehler(null);
    setLaeuft('freigeben');
    try {
      setFrischFreigegeben(await gebeFrei(url));
    } catch (e) {
      setFehler(meldung(e, 'Die Truhe konnte nicht freigegeben werden.'));
    } finally {
      setLaeuft(null);
    }
  }

  async function beitreten() {
    if (!code.trim()) {
      setFehler('Bitte gib den Code der Truhe ein.');
      return;
    }
    const url = ziel();
    if (url === null) return;
    setFehler(null);
    setLaeuft('beitreten');
    try {
      await verbinde({ url, token: code });
      setCode('');
      setFrischFreigegeben(null);
    } catch (e) {
      setFehler(meldung(e, 'Der Beitritt ist fehlgeschlagen.'));
    } finally {
      setLaeuft(null);
    }
  }

  if (verbunden && !laeuft) {
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

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className="knopf knopf-leise sm:flex-1"
            disabled={status.zustand === 'laeuft'}
            onClick={() => void gleicheAb()}
          >
            Jetzt abgleichen
          </button>
          <Trennen />
        </div>

        {!codeUngueltig && <Zugangscode key={frischFreigegeben ?? 'bestehend'} frischFreigegeben={frischFreigegeben} />}
      </div>
    );
  }

  // Auf dem eigenen Server freigeben geht nur, wenn dort der Abgleich läuft und er neue Truhen annimmt.
  // Bei einer anderen Adresse zeigt sich das erst beim Versuch.
  const eigenerServer = normalisiereUrl(adresse) === eigeneAdresse();
  const kannFreigeben = !eigenerServer || (server?.da === true && server.neueTruhen);

  return (
    <div className="flex flex-col gap-4">
      {eigenerServer && server && !server.da && (
        <p className="text-text2 text-sm">
          Unter dieser Adresse läuft kein Abgleich-Server. Hast du einen eigenen, trage unten seine Adresse ein.
        </p>
      )}
      {eigenerServer && server?.da && !server.neueTruhen && (
        <p className="text-text2 text-sm">
          Auf diesem Server lassen sich keine neuen Truhen anlegen. Einer vorhandenen kannst du mit ihrem Code beitreten.
        </p>
      )}

      {kannFreigeben && (
        <section className="flex flex-col gap-2" aria-labelledby="freigeben-titel">
          <h3 id="freigeben-titel" className="font-bold">
            Diese Truhe für weitere Geräte freigeben
          </h3>
          <p className="text-text2 text-sm">
            Legt die Truhe dieses Geräts auf dem Server ab. Du bekommst einen Code, mit dem andere Geräte beitreten.
          </p>
          <button type="button" className="knopf knopf-primaer" disabled={laeuft !== null} onClick={() => void freigeben()}>
            {laeuft === 'freigeben' ? 'Gebe frei …' : 'Truhe freigeben'}
          </button>
        </section>
      )}

      <form
        className={`flex flex-col gap-2 ${kannFreigeben ? 'border-rand border-t pt-4' : ''}`}
        aria-labelledby="beitreten-titel"
        onSubmit={(e) => {
          e.preventDefault();
          void beitreten();
        }}
      >
        <h3 id="beitreten-titel" className="font-bold">
          Einer vorhandenen Truhe beitreten
        </h3>
        <p className="text-text2 text-sm">
          Mit dem Code, den das erste Gerät bekommen hat. Was auf diesem Gerät schon eingetragen ist, kommt zur Truhe
          dazu.
        </p>
        <label className="beschriftung mb-0" htmlFor="sync-token">
          Code der Truhe
        </label>
        <CodeFeld id="sync-token" wert={code} onChange={setCode} platzhalter="xxxx-xxxx-xxxx-xxxx-xxxx" />
        <button type="submit" className="knopf knopf-leise" disabled={laeuft !== null}>
          {laeuft === 'beitreten' ? 'Trete bei …' : 'Beitreten'}
        </button>
      </form>

      {fehler && <Fehlerkasten text={fehler} />}

      <details className="border-rand rounded-2xl border" open={server !== null && !server.da}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          Adresse des Servers
        </summary>
        <div className="border-rand border-t p-4">
          <input
            id="sync-url"
            className="feld"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://truhe.example.de"
            aria-label="Adresse des Servers"
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
          />
          <p className="text-text2 mt-1.5 text-sm">
            Nur ändern, wenn der Abgleich über einen anderen Server läuft als den, von dem diese App geladen wurde.
          </p>
        </div>
      </details>
    </div>
  );
}
