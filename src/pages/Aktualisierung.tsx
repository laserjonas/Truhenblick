import { useCallback, useEffect, useState } from 'react';
import type { UpdateStand } from '../../shared/types.ts';
import { ladeNeueAppVersion, neueAppVersionVorhanden } from '../hooks/appAktualisierung.ts';
import { useSyncStatus } from '../sync/auto.ts';
import { holeUpdateStand, starteServerUpdate, SyncFehler } from '../sync/client.ts';

type AppStand = 'unbekannt' | 'aktuell' | 'neu';

type Ablauf =
  | { art: 'ruhe' }
  /** `vorherBeendet`: Abschlusszeit des vorigen Updates – erst ein neuerer Abschluss zählt als Ergebnis. */
  | { art: 'laeuft'; seit: number; vorherBeendet: string | null }
  | { art: 'fertig'; meldung: string }
  | { art: 'fehler'; meldung: string; protokoll: string | null };

const ABFRAGE_MS = 3000;
/** So lange darf zwischen Anstoßen und sichtbarem Start vergehen. */
const START_FRIST_MS = 90_000;
const HOECHSTDAUER_MS = 20 * 60 * 1000;

const kurz = (commit: string | null) => (commit ? commit.slice(0, 7) : 'unbekannt');

function meldung(fehler: unknown): string {
  return fehler instanceof SyncFehler ? fehler.message : 'Der Server hat nicht geantwortet.';
}

function Protokoll({ text }: { text: string }) {
  return (
    <details className="text-sm">
      <summary className="text-akzent inline-flex min-h-11 cursor-pointer items-center font-semibold">
        Protokoll anzeigen
      </summary>
      <pre className="border-rand bg-mulde max-h-64 overflow-auto rounded-xl border p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    </details>
  );
}

/** Updates: neue App-Version laden und – wenn verbunden – den Server aktualisieren. */
export function Aktualisierung() {
  const verbunden = useSyncStatus().zustand !== 'aus';
  const [app, setApp] = useState<AppStand>('unbekannt');
  const [server, setServer] = useState<UpdateStand | null>(null);
  const [serverFehler, setServerFehler] = useState<string | null>(null);
  const [sucht, setSucht] = useState(false);
  const [gesucht, setGesucht] = useState(false);
  const [ablauf, setAblauf] = useState<Ablauf>({ art: 'ruhe' });
  const [laedtNeu, setLaedtNeu] = useState(false);

  const pruefeApp = useCallback(async () => {
    const neu = await neueAppVersionVorhanden();
    setApp(neu === null ? 'unbekannt' : neu ? 'neu' : 'aktuell');
  }, []);

  const ladeServer = useCallback(
    async (pruefen: boolean) => {
      if (!verbunden) {
        setServer(null);
        setServerFehler(null);
        return;
      }
      try {
        const stand = await holeUpdateStand(pruefen);
        setServer(stand);
        setServerFehler(null);
        // Läuft bereits ein Update (von einem anderen Gerät oder vor einem Neuladen angestoßen)?
        if (stand?.laeuft) {
          setAblauf((a) => (a.art === 'laeuft' ? a : { art: 'laeuft', seit: Date.now(), vorherBeendet: null }));
        }
      } catch (fehler) {
        setServer(null);
        setServerFehler(meldung(fehler));
      }
    },
    [verbunden],
  );

  useEffect(() => {
    void pruefeApp();
    void ladeServer(false);
  }, [pruefeApp, ladeServer]);

  // Während ein Update läuft, regelmäßig nachfragen. Das Backend startet dabei neu –
  // einzelne fehlgeschlagene Abfragen gehören dazu.
  useEffect(() => {
    if (ablauf.art !== 'laeuft') return;
    const { seit, vorherBeendet } = ablauf;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const stand = await holeUpdateStand(false);
          if (!stand) return;
          setServer(stand);
          if (stand.laeuft) return;
          if (stand.letztes && stand.letztes.beendet !== vorherBeendet) {
            if (stand.letztes.zustand === 'fertig') {
              setAblauf({ art: 'fertig', meldung: stand.letztes.meldung });
              void pruefeApp();
            } else {
              setAblauf({ art: 'fehler', meldung: stand.letztes.meldung, protokoll: stand.protokoll });
            }
          } else if (Date.now() - seit > START_FRIST_MS) {
            setAblauf({
              art: 'fehler',
              meldung: 'Das Update ist auf dem Server nicht angelaufen. Dort hilft: truhenblick-update',
              protokoll: null,
            });
          }
        } catch {
          if (Date.now() - seit > HOECHSTDAUER_MS) {
            setAblauf({ art: 'fehler', meldung: 'Der Server antwortet nicht mehr. Bitte dort nachsehen.', protokoll: null });
          }
        }
      })();
    }, ABFRAGE_MS);
    return () => clearInterval(timer);
  }, [ablauf, pruefeApp]);

  async function suchen() {
    setSucht(true);
    await Promise.all([pruefeApp(), ladeServer(true)]);
    setSucht(false);
    setGesucht(true);
  }

  async function aktualisieren() {
    const vorherBeendet = server?.letztes?.beendet ?? null;
    try {
      await starteServerUpdate();
      setAblauf({ art: 'laeuft', seit: Date.now(), vorherBeendet });
    } catch (fehler) {
      setAblauf({ art: 'fehler', meldung: meldung(fehler), protokoll: null });
    }
  }

  function neuLaden() {
    setLaedtNeu(true);
    void ladeNeueAppVersion();
  }

  const neuLadenKnopf = (
    <button type="button" className="knopf knopf-primaer" disabled={laedtNeu} onClick={neuLaden}>
      {laedtNeu ? 'Lade neu …' : 'App neu laden'}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------ Diese App */}
      <section className="flex flex-col gap-2" aria-labelledby="update-app">
        <h3 id="update-app" className="font-bold">
          Diese App
        </h3>
        <p className="text-sm" role="status">
          Version {__APP_VERSION__}
          {app === 'aktuell' && gesucht && ' – ✓ aktuell'}
          {app === 'unbekannt' && gesucht && ' – ließ sich nicht prüfen (offline?)'}
        </p>
        {app === 'neu' && ablauf.art !== 'laeuft' && (
          <div className="border-akzent bg-akzent-weich flex flex-col gap-2 rounded-2xl border p-3">
            <p className="text-sm">
              <strong>Eine neue Version der App liegt bereit.</strong> Deine Daten bleiben beim Neuladen erhalten.
            </p>
            {neuLadenKnopf}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ Server */}
      <section className="border-rand flex flex-col gap-2 border-t pt-4" aria-labelledby="update-server">
        <h3 id="update-server" className="font-bold">
          Server
        </h3>

        {!verbunden && (
          <p className="text-text2 text-sm">
            Den Server kannst du von hier aus aktualisieren, sobald dieses Gerät mit ihm verbunden ist (oben unter
            „Abgleich zwischen Geräten“). Von Hand geht es dort mit <code>truhenblick-update</code>.
          </p>
        )}

        {serverFehler && (
          <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
            {serverFehler}
          </p>
        )}

        {server && !server.moeglich && server.grund === 'andere-truhe' && (
          <p className="text-text2 text-sm">
            Den Server aktualisieren können nur die Geräte der Truhe, die dort zuerst angelegt wurde. Neue Versionen
            der App lädst du trotzdem über „Nach Updates suchen“.
          </p>
        )}

        {server && !server.moeglich && server.grund !== 'andere-truhe' && (
          <div className="text-text2 text-sm">
            <p>
              Dieser Server wird nicht aus der App aktualisiert – das ist zum Beispiel bei Docker so. Aktualisiere ihn
              dort, wo er läuft:
            </p>
            <pre className="border-rand bg-mulde text-text mt-2 overflow-x-auto rounded-xl border p-3 text-xs">
              git pull && docker compose --profile sync up -d --build
            </pre>
            <p className="mt-2">Danach hier „Nach Updates suchen“ antippen, um die neue App zu laden.</p>
          </div>
        )}

        {server?.moeglich && ablauf.art === 'ruhe' && (
          <>
            {server.neu === true && (
              <div className="border-akzent bg-akzent-weich flex flex-col gap-2 rounded-2xl border p-3">
                <p className="text-sm">
                  <strong>Neue Version verfügbar</strong> ({kurz(server.verfuegbar)}; installiert ist{' '}
                  {kurz(server.installiert)}). Vor dem Update wird die Datenbank gesichert, eure Daten bleiben erhalten.
                </p>
                <button type="button" className="knopf knopf-primaer" onClick={() => void aktualisieren()}>
                  Jetzt aktualisieren
                </button>
              </div>
            )}
            {server.neu === false && (
              <p className="text-sm" role="status">
                ✓ Der Server ist auf dem neuesten Stand ({kurz(server.installiert)}).
              </p>
            )}
            {server.neu === null && (
              <p className="text-text2 text-sm" role="status">
                Ob es eine neue Version gibt, ließ sich nicht prüfen – die Quelle war vom Server aus nicht erreichbar.
              </p>
            )}
            {server.letztes?.zustand === 'fehler' && (
              <div className="border-ueber-rand bg-ueber-bg text-ueber-text flex flex-col gap-1 rounded-2xl border p-3">
                <p className="text-sm font-medium">Letzter Versuch: {server.letztes.meldung}</p>
                {server.protokoll && <Protokoll text={server.protokoll} />}
              </div>
            )}
          </>
        )}

        {ablauf.art === 'laeuft' && (
          <p className="border-bald-rand bg-bald-bg text-bald-text rounded-2xl border p-3 text-sm font-medium" role="status">
            Der Server wird aktualisiert … Das dauert meist unter einer Minute. Du kannst die App solange
            weiterbenutzen; der Abgleich setzt kurz aus.
          </p>
        )}

        {ablauf.art === 'fertig' && (
          <div className="border-frisch-rand bg-frisch-bg text-frisch-text flex flex-col gap-2 rounded-2xl border p-3" role="status">
            <p className="text-sm font-medium">
              ✓ {ablauf.meldung}
              {app === 'neu' && ' Lade die App neu, um die neue Version zu verwenden.'}
            </p>
          </div>
        )}

        {ablauf.art === 'fehler' && (
          <div className="border-ueber-rand bg-ueber-bg text-ueber-text flex flex-col gap-1 rounded-2xl border p-3" role="alert">
            <p className="text-sm font-medium">{ablauf.meldung}</p>
            {ablauf.protokoll && <Protokoll text={ablauf.protokoll} />}
          </div>
        )}
      </section>

      <button
        type="button"
        className="knopf knopf-leise"
        disabled={sucht || ablauf.art === 'laeuft'}
        onClick={() => {
          if (ablauf.art !== 'laeuft') setAblauf({ art: 'ruhe' });
          void suchen();
        }}
      >
        {sucht ? 'Suche …' : 'Nach Updates suchen'}
      </button>
    </div>
  );
}
