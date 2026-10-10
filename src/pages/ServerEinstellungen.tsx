import { useCallback, useEffect, useState } from 'react';
import type { Erreichbarkeit, ServerEinstellungen as Einstellungen } from '../../shared/types.ts';
import { abmelden, pruefeAnmeldung, useAnmeldung } from '../sync/anmeldung.ts';
import { useSyncStatus } from '../sync/auto.ts';
import {
  holeServerEinstellungen,
  meldeAndereAb,
  pruefeAdresse,
  setzePasswort,
  speichereServerEinstellungen,
  SyncFehler,
  type AdressPruefung,
} from '../sync/client.ts';

const MIN_PASSWORT_LAENGE = 8;

function meldung(fehler: unknown): string {
  return fehler instanceof SyncFehler ? fehler.message : 'Der Server hat nicht geantwortet.';
}

function Fehlerkasten({ text }: { text: string }) {
  return (
    <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
      {text}
    </p>
  );
}

const ARTEN: { wert: Erreichbarkeit; titel: string; text: string }[] = [
  {
    wert: 'heimnetz',
    titel: 'Nur im Heimnetz',
    text: 'Über http:// und die IP-Adresse. Als App installieren lässt sich Truhenblick so nicht – dafür braucht es HTTPS.',
  },
  {
    wert: 'proxy',
    titel: 'Über einen Reverse Proxy mit HTTPS',
    text: 'Zum Beispiel Nginx Proxy Manager, Traefik oder ein Cloudflare-Tunnel. Der Proxy kümmert sich um das Zertifikat.',
  },
  {
    wert: 'selbst',
    titel: 'Truhenblick holt das Zertifikat selbst',
    text: 'Ohne Proxy: Die Adresse zeigt direkt auf diesen Server, und die Ports 80 und 443 sind aus dem Internet erreichbar.',
  },
];

const PRUEF_TEXT: Record<AdressPruefung, (adresse: string) => string> = {
  ok: (a) => `✓ Unter https://${a} antwortet dieser Server.`,
  'anderer-server': (a) => `Unter https://${a} antwortet etwas anderes als dieser Server. Zeigt die Adresse auf den richtigen Rechner?`,
  'nicht-erreichbar': (a) => `https://${a} ist von diesem Gerät aus nicht erreichbar – oder es gibt dort noch kein gültiges Zertifikat.`,
};

/** Wie und unter welcher Adresse der Server erreichbar ist. */
function Erreichbar({ stand, kennung, uebernimm }: { stand: Einstellungen; kennung: string | null; uebernimm: (neu: Einstellungen) => void }) {
  const [art, setArt] = useState<Erreichbarkeit>(stand.erreichbarkeit);
  const [adresse, setAdresse] = useState(stand.adresse);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const [pruefung, setPruefung] = useState<AdressPruefung | 'laeuft' | null>(null);

  const geaendert = art !== stand.erreichbarkeit || (art !== 'heimnetz' && adresse.trim() !== stand.adresse);
  const hier = window.location.hostname;
  // Wer die App gerade direkt über http:// aufruft (IP im Heimnetz), sieht hier das Ziel für den Proxy.
  const direkt = window.location.protocol === 'http:' && hier !== stand.adresse;
  const eingestellt = stand.erreichbarkeit !== 'heimnetz' && stand.adresse !== '';

  async function speichern() {
    setLaeuft(true);
    setFehler(null);
    setGespeichert(false);
    setPruefung(null);
    try {
      const neu = await speichereServerEinstellungen(art, adresse);
      uebernimm(neu);
      setAdresse(neu.adresse);
      setGespeichert(true);
      void pruefeAnmeldung();
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }

  async function pruefen() {
    setPruefung('laeuft');
    setPruefung(await pruefeAdresse(stand.adresse, kennung));
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="server-erreichbar">
      <h3 id="server-erreichbar" className="font-bold">
        Erreichbarkeit
      </h3>
      <p className="text-text2 text-sm">
        Du nutzt die App gerade über <strong className="text-text break-all">{window.location.origin}</strong>.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="beschriftung">Wie ist dieser Server erreichbar?</legend>
        {ARTEN.map((a) => (
          <label
            key={a.wert}
            className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${art === a.wert ? 'border-akzent bg-akzent-weich' : 'border-rand bg-karte'}`}
          >
            <input
              type="radio"
              name="erreichbarkeit"
              className="accent-akzent mt-1 size-5 shrink-0"
              checked={art === a.wert}
              onChange={() => {
                setArt(a.wert);
                setGespeichert(false);
              }}
            />
            <span>
              <span className="block font-semibold">{a.titel}</span>
              <span className="text-text2 block text-sm">{a.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {art !== 'heimnetz' && (
        <div>
          <label className="beschriftung" htmlFor="server-adresse">
            Adresse des Servers
          </label>
          <input
            id="server-adresse"
            className="feld"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="truhe.example.de"
            value={adresse}
            onChange={(e) => {
              setAdresse(e.target.value);
              setGespeichert(false);
            }}
          />
          <p className="text-text2 mt-1.5 text-sm">Der Name, unter dem die App erreichbar sein soll – ohne https://.</p>
        </div>
      )}

      {art === 'proxy' && (
        <div className="border-rand bg-mulde rounded-2xl border p-3 text-sm">
          <p className="font-semibold">So trägst du Truhenblick im Proxy ein</p>
          <ul className="mt-1 list-disc pl-5">
            <li>
              Ziel ist dieser Server über <strong>http</strong> (nicht https)
              {direkt ? (
                <>
                  : Adresse <code className="break-all">{hier}</code>, Port <code>{window.location.port || '80'}</code>
                </>
              ) : (
                ' – seine IP-Adresse im Heimnetz und der Port, unter dem er dort antwortet (meist 80)'
              )}
              .
            </li>
            <li>HTTPS und das Zertifikat übernimmt der Proxy; WebSockets braucht Truhenblick nicht.</li>
            <li>Am Server selbst ist dafür nichts weiter einzustellen.</li>
          </ul>
        </div>
      )}

      {art === 'selbst' && (
        <p className="border-rand bg-mulde rounded-2xl border p-3 text-sm">
          Das Zertifikat holt der Server, sobald die Adresse zum ersten Mal über https:// aufgerufen wird – das dauert
          beim ersten Mal ein paar Sekunden. Mit Docker muss dafür Port 443 freigegeben sein
          (<code>docker-compose.https.yml</code>).
        </p>
      )}

      {fehler && <Fehlerkasten text={fehler} />}
      {gespeichert && !geaendert && (
        <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
          ✓ Gespeichert.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="knopf knopf-primaer sm:flex-1" disabled={laeuft || !geaendert} onClick={() => void speichern()}>
          {laeuft ? 'Speichere …' : 'Speichern'}
        </button>
        {eingestellt && !geaendert && (
          <button type="button" className="knopf knopf-leise sm:flex-1" disabled={pruefung === 'laeuft'} onClick={() => void pruefen()}>
            {pruefung === 'laeuft' ? 'Prüfe …' : 'Adresse prüfen'}
          </button>
        )}
      </div>

      {pruefung && pruefung !== 'laeuft' && (
        <p
          className={`rounded-2xl border p-3 text-sm ${pruefung === 'ok' ? 'border-frisch-rand bg-frisch-bg text-frisch-text' : 'border-bald-rand bg-bald-bg text-bald-text font-medium'}`}
          role="status"
        >
          {PRUEF_TEXT[pruefung](stand.adresse)}
        </p>
      )}

      {eingestellt && !geaendert && hier !== stand.adresse && (
        <p className="text-text2 text-sm">
          Unter{' '}
          <a className="text-akzent font-semibold break-all underline" href={`https://${stand.adresse}`}>
            https://{stand.adresse}
          </a>{' '}
          lässt sich die App installieren. Dort ist sie für den Browser eine eigene App: einmal mit dem Code der Truhe
          beitreten, dann kommen die Daten vom Server.
        </p>
      )}
    </section>
  );
}

/** Passwort für den Server festlegen, ändern oder die Anmeldung abschalten. */
function Passwort({ stand, neuLaden }: { stand: Einstellungen; neuLaden: () => Promise<void> }) {
  const [neu, setNeu] = useState('');
  const [wiederholt, setWiederholt] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [abschalten, setAbschalten] = useState(false);

  async function ausfuehren(aktion: () => Promise<void>, erfolg: string) {
    setLaeuft(true);
    setFehler(null);
    setHinweis(null);
    try {
      await aktion();
      await Promise.all([neuLaden(), pruefeAnmeldung()]);
      setHinweis(erfolg);
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }

  function festlegen() {
    if (neu.length < MIN_PASSWORT_LAENGE) {
      setFehler(`Das Passwort braucht mindestens ${MIN_PASSWORT_LAENGE} Zeichen.`);
      return;
    }
    if (neu !== wiederholt) {
      setFehler('Die beiden Eingaben stimmen nicht überein.');
      return;
    }
    void ausfuehren(
      async () => {
        await setzePasswort(neu);
        setNeu('');
        setWiederholt('');
      },
      stand.anmeldung
        ? '✓ Das Passwort ist geändert. Alle anderen Geräte müssen sich neu anmelden.'
        : '✓ Die Anmeldung ist eingeschaltet. Dieses Gerät ist schon angemeldet – alle anderen fragen beim nächsten Öffnen nach dem Passwort.',
    );
  }

  return (
    <section className="border-rand flex flex-col gap-3 border-t pt-4" aria-labelledby="server-anmeldung">
      <h3 id="server-anmeldung" className="font-bold">
        Anmeldung
      </h3>
      {stand.anmeldung ? (
        <p className="text-sm" role="status">
          <strong>✓ Eingeschaltet.</strong> Wer die App öffnet, muss sich mit dem Passwort anmelden.{' '}
          {stand.sitzungen === 1 ? 'Angemeldet ist ein Gerät.' : `Angemeldet sind ${stand.sitzungen} Geräte.`}
        </p>
      ) : (
        <p className="text-text2 text-sm">
          Ausgeschaltet: Wer die Adresse kennt, kann die App öffnen und eine eigene Truhe anlegen. An eure Truhe kommt
          trotzdem nur, wer ihren Code hat. Für einen Server, der aus dem Internet erreichbar ist, empfiehlt sich ein
          Passwort.
        </p>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          festlegen();
        }}
      >
        <input type="text" name="username" autoComplete="username" value="truhenblick" readOnly hidden />
        <div>
          <label className="beschriftung" htmlFor="server-passwort">
            {stand.anmeldung ? 'Neues Passwort' : 'Passwort'}
          </label>
          <input
            id="server-passwort"
            className="feld"
            type="password"
            autoComplete="new-password"
            value={neu}
            onChange={(e) => setNeu(e.target.value)}
          />
          <p className="text-text2 mt-1.5 text-sm">Mindestens {MIN_PASSWORT_LAENGE} Zeichen – ein kurzer Satz ist gut zu merken und schwer zu erraten.</p>
        </div>
        <div>
          <label className="beschriftung" htmlFor="server-passwort-2">
            Passwort wiederholen
          </label>
          <input
            id="server-passwort-2"
            className="feld"
            type="password"
            autoComplete="new-password"
            value={wiederholt}
            onChange={(e) => setWiederholt(e.target.value)}
          />
        </div>

        {fehler && <Fehlerkasten text={fehler} />}
        {hinweis && (
          <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
            {hinweis}
          </p>
        )}

        <button type="submit" className="knopf knopf-primaer" disabled={laeuft}>
          {laeuft ? 'Speichere …' : stand.anmeldung ? 'Passwort ändern' : 'Anmeldung einschalten'}
        </button>
      </form>

      {stand.anmeldung && !abschalten && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="knopf knopf-leise sm:flex-1"
            disabled={laeuft || stand.sitzungen < 2}
            onClick={() => void ausfuehren(meldeAndereAb, '✓ Alle anderen Geräte sind abgemeldet.')}
          >
            Alle anderen Geräte abmelden
          </button>
          <button type="button" className="knopf knopf-gefahr sm:flex-1" disabled={laeuft} onClick={() => setAbschalten(true)}>
            Anmeldung abschalten
          </button>
        </div>
      )}

      {abschalten && (
        <div className="border-bald-rand bg-bald-bg text-bald-text flex flex-col gap-2 rounded-2xl border p-3" role="group" aria-label="Anmeldung abschalten">
          <p className="text-sm font-medium">
            Danach kann wieder jeder die App öffnen, der die Adresse kennt. Eure Truhe bleibt durch ihren Code geschützt.
          </p>
          <button
            type="button"
            className="knopf knopf-gefahr"
            disabled={laeuft}
            onClick={() => {
              setAbschalten(false);
              void ausfuehren(() => setzePasswort(null), '✓ Die Anmeldung ist abgeschaltet.');
            }}
          >
            Ja, abschalten
          </button>
          <button type="button" className="knopf knopf-leise" onClick={() => setAbschalten(false)}>
            Abbrechen
          </button>
        </div>
      )}

      <p className="text-text2 text-sm">
        Home Assistant fragt weiter mit seinem Lese-Schlüssel ab. Passwort vergessen und kein Gerät mehr angemeldet? Auf
        dem Server schaltet <code>truhenblick-anmeldung-aus</code> die Anmeldung ab.
      </p>
    </section>
  );
}

/** Dieses Gerät abmelden – für alle, die angemeldet sind. */
function Abmelden() {
  const [laeuft, setLaeuft] = useState(false);
  return (
    <section className="border-rand flex flex-col gap-2 border-t pt-4" aria-labelledby="server-abmelden">
      <h3 id="server-abmelden" className="font-bold">
        Dieses Gerät
      </h3>
      <p className="text-text2 text-sm">
        Nach dem Abmelden fragt die App wieder nach dem Passwort. Was auf diesem Gerät gespeichert ist, bleibt erhalten.
      </p>
      <button
        type="button"
        className="knopf knopf-leise"
        disabled={laeuft}
        onClick={() => {
          setLaeuft(true);
          void abmelden().finally(() => setLaeuft(false));
        }}
      >
        {laeuft ? 'Melde ab …' : 'Abmelden'}
      </button>
    </section>
  );
}

/**
 * Einstellungen des Servers: Adresse und Erreichbarkeit (statt sie in der Konfiguration des
 * Webservers einzutragen) und das Passwort für die Anmeldung.
 */
export function ServerEinstellungen() {
  const verbunden = useSyncStatus().zustand !== 'aus';
  const anmeldung = useAnmeldung();
  const [stand, setStand] = useState<Einstellungen | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const lade = useCallback(async () => {
    if (!verbunden) {
      setStand(null);
      setFehler(null);
      return;
    }
    try {
      setStand(await holeServerEinstellungen());
      setFehler(null);
    } catch (e) {
      setStand(null);
      setFehler(meldung(e));
    }
  }, [verbunden]);

  useEffect(() => {
    void lade();
  }, [lade]);

  const angemeldet = anmeldung.stand === 'angemeldet';

  if (!verbunden) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-text2 text-sm">
          Adresse, Reverse Proxy und Anmeldung stellst du hier ein, sobald dieses Gerät mit dem Server verbunden ist –
          oben unter „Abgleich zwischen Geräten“.
        </p>
        {angemeldet && <Abmelden />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {fehler && <Fehlerkasten text={fehler} />}

      {stand && !stand.betreiber && (
        <p className="text-text2 text-sm">
          Die Einstellungen des Servers ändern nur die Geräte der Truhe, die dort zuerst angelegt wurde.
        </p>
      )}

      {stand?.betreiber && (
        <>
          <Erreichbar stand={stand} kennung={anmeldung.server?.kennung ?? null} uebernimm={setStand} />
          <Passwort stand={stand} neuLaden={lade} />
        </>
      )}

      {angemeldet && <Abmelden />}
    </div>
  );
}
