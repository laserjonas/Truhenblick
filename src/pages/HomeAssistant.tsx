import { useEffect, useMemo, useState } from 'react';
import { haKonfiguration, HA_SENSOREN } from '../logic/homeAssistant.ts';
import { useSyncStatus } from '../sync/auto.ts';
import { erzeugeLeseSchluessel, leseSchluesselLokal, leseZugangAktiv, SyncFehler, widerrufeLeseSchluessel } from '../sync/client.ts';

function meldung(fehler: unknown): string {
  return fehler instanceof SyncFehler ? fehler.message : 'Der Server hat nicht geantwortet.';
}

/** Textblock zum Übernehmen – mit Kopieren, wo der Browser es erlaubt; sonst lässt er sich markieren. */
function Kopierblock({ text, name }: { text: string; name: string }) {
  const [kopiert, setKopiert] = useState(false);
  const kannKopieren = typeof navigator.clipboard?.writeText === 'function';

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    } catch {
      setKopiert(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <pre
        className="border-rand bg-mulde text-text max-h-72 overflow-auto rounded-xl border p-3 font-mono text-xs leading-relaxed select-all"
        aria-label={name}
        tabIndex={0}
      >
        {text}
      </pre>
      {kannKopieren && (
        <button type="button" className="knopf knopf-leise min-h-11 self-start px-4 text-sm" onClick={() => void kopieren()}>
          {kopiert ? '✓ Kopiert' : 'Kopieren'}
        </button>
      )}
    </div>
  );
}

/**
 * Home Assistant anbinden: erzeugt einen Lese-Schlüssel und die fertige Konfiguration
 * für die eingebaute RESTful-Integration samt Dashboard-Karte.
 */
export function HomeAssistant() {
  const status = useSyncStatus();
  const verbunden = status.zustand !== 'aus';
  const [schluessel, setSchluessel] = useState<string | null>(null);
  // Gibt es auf dem Server einen Schlüssel? null = unbekannt
  const [aktiv, setAktiv] = useState<boolean | null>(null);
  const [adresse, setAdresse] = useState(() => status.url || window.location.origin);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!verbunden) {
      setSchluessel(null);
      setAktiv(null);
      return;
    }
    let aktuell = true;
    void (async () => {
      const lokal = await leseSchluesselLokal();
      let aufServer: boolean | null = null;
      try {
        aufServer = await leseZugangAktiv();
      } catch {
        // Server gerade nicht erreichbar oder zu alt – die Knöpfe melden das beim Antippen.
      }
      if (!aktuell) return;
      setAktiv(aufServer);
      // Ein lokal gemerkter Schlüssel gilt nur, solange der Server ihn noch kennt.
      setSchluessel(aufServer === false ? null : lokal);
    })();
    return () => {
      aktuell = false;
    };
  }, [verbunden]);

  const zeitzone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin', []);
  const konfig = useMemo(
    () => (schluessel ? haKonfiguration({ adresse: adresse.trim() || window.location.origin, schluessel, zeitzone }) : null),
    [schluessel, adresse, zeitzone],
  );

  async function ausfuehren(aktion: () => Promise<void>) {
    setLaeuft(true);
    setFehler(null);
    try {
      await aktion();
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setLaeuft(false);
    }
  }

  const erzeugen = () =>
    ausfuehren(async () => {
      setSchluessel(await erzeugeLeseSchluessel());
      setAktiv(true);
    });
  const widerrufen = () =>
    ausfuehren(async () => {
      await widerrufeLeseSchluessel();
      setSchluessel(null);
      setAktiv(false);
    });

  if (!verbunden) {
    return (
      <p className="text-text2 text-sm">
        Home Assistant fragt die Truhe beim Server ab. Gib sie dafür zuerst frei – oben unter „Abgleich zwischen
        Geräten“.
      </p>
    );
  }

  const lokalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(adresse.trim());

  return (
    <div className="flex flex-col gap-4">
      {fehler && (
        <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
          {fehler}
        </p>
      )}

      {!konfig ? (
        <>
          {aktiv === true && (
            <p className="text-text2 text-sm">
              Für diese Truhe gibt es schon einen Lese-Schlüssel, er wurde aber auf einem anderen Gerät erzeugt und
              lässt sich hier nicht anzeigen. Ein neuer ersetzt ihn – Home Assistant braucht dann den neuen.
            </p>
          )}
          <button type="button" className="knopf knopf-primaer" disabled={laeuft} onClick={() => void erzeugen()}>
            {laeuft ? 'Richte ein …' : aktiv === true ? 'Neuen Lese-Schlüssel erzeugen' : 'Für Home Assistant einrichten'}
          </button>
          {aktiv === true && (
            <button type="button" className="knopf knopf-gefahr" disabled={laeuft} onClick={() => void widerrufen()}>
              Zugang widerrufen
            </button>
          )}
        </>
      ) : (
        <>
          <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
            <strong>✓ Lese-Schlüssel ist eingerichtet.</strong> Er zeigt Home Assistant nur die Übersicht dieser Truhe;
            ändern lässt sich damit nichts.
          </p>

          <div>
            <label className="beschriftung" htmlFor="ha-adresse">
              Adresse, unter der Home Assistant diesen Server erreicht
            </label>
            <input
              id="ha-adresse"
              className="feld"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
            />
            {lokalhost && (
              <p className="text-gefahr mt-1.5 text-sm font-medium">
                „localhost“ meint für Home Assistant sich selbst. Trage hier die Adresse im Netzwerk ein, z. B.
                http://192.168.1.50.
              </p>
            )}
          </div>

          <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
            <li>
              <p className="mb-1.5">
                In Home Assistant in die Datei <code>secrets.yaml</code> eintragen:
              </p>
              <Kopierblock text={konfig.secrets} name="Eintrag für secrets.yaml" />
            </li>
            <li>
              <p className="mb-1.5">
                In <code>configuration.yaml</code> einfügen. Gibt es dort schon einen Abschnitt <code>rest:</code>,
                dann nur die Zeilen ab <code>- resource:</code> anhängen.
              </p>
              <Kopierblock text={konfig.konfiguration} name="Abschnitt für configuration.yaml" />
            </li>
            <li>
              Home Assistant neu starten. Danach gibt es die Sensoren <code>{HA_SENSOREN.aufbrauchen}</code>,{' '}
              <code>{HA_SENSOREN.abgelaufen}</code> und <code>{HA_SENSOREN.artikel}</code>; sie werden alle zehn
              Minuten aktualisiert.
            </li>
            <li>
              <p className="mb-1.5">
                Im Dashboard „Karte hinzufügen“ → „Manuell“ und diese Karte einfügen – sie listet, was bald abläuft:
              </p>
              <Kopierblock text={konfig.karte} name="Karte für das Dashboard" />
            </li>
          </ol>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="knopf knopf-leise sm:flex-1" disabled={laeuft} onClick={() => void erzeugen()}>
              Neuen Schlüssel erzeugen
            </button>
            <button type="button" className="knopf knopf-gefahr sm:flex-1" disabled={laeuft} onClick={() => void widerrufen()}>
              Zugang widerrufen
            </button>
          </div>
          <p className="text-text2 text-sm">
            Ein neuer Schlüssel macht den bisherigen ungültig – dann muss der Eintrag in <code>secrets.yaml</code>{' '}
            ersetzt werden.
          </p>
        </>
      )}
    </div>
  );
}
