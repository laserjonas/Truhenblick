import { useEffect, useMemo, useState } from 'react';
import type { Bereich } from '../../shared/types.ts';
import { CodeFeld } from '../components/CodeAnzeige.tsx';
import { TruhenGrafik } from '../components/TruhenGrafik.tsx';
import { Zahlwaehler } from '../components/Zahlwaehler.tsx';
import { truheEinrichten } from '../db/repo.ts';
import { baueStruktur, standardBereiche, type TruhenKonfig } from '../logic/truhe.ts';
import { legeAnUndVerbinde, useSyncStatus, verbinde } from '../sync/auto.ts';
import { normalisiereUrl, pruefeServer, SyncFehler, type ServerInfo } from '../sync/client.ts';

/** Baut aus dem Entwurf Bereiche mit Platzhalter-IDs für die Vorschau. */
function vorschauBereiche(konfig: TruhenKonfig): Bereich[] {
  return standardBereiche(konfig).map((e, i) => ({
    id: e.typ === 'ebene' ? `ebene-${e.reihenfolge}` : `${e.typ}-${i}`,
    name: e.name,
    typ: e.typ,
    reihenfolge: e.reihenfolge,
    parentId: e.ebeneIndex === null ? null : `ebene-${e.ebeneIndex}`,
    geaendertAm: '',
    geloeschtAm: null,
  }));
}

type Modus = 'neu' | 'beitreten';

/** Erster Start: eine neue Truhe anlegen – oder mit einem Code einer vorhandenen beitreten. */
export function Einrichtung() {
  const verbunden = useSyncStatus().zustand !== 'aus';
  const [modus, setModus] = useState<Modus>('neu');
  // Liefert der Server, von dem die App kommt, auch den Abgleich? null = wird noch geprüft.
  const [server, setServer] = useState<ServerInfo | null>(null);
  useEffect(() => {
    let aktuell = true;
    void pruefeServer('').then((info) => {
      if (aktuell) setServer(info);
    });
    return () => {
      aktuell = false;
    };
  }, []);

  const reiter = (m: Modus, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={modus === m}
      className={`min-h-12 flex-1 rounded-xl px-3 font-semibold ${modus === m ? 'bg-akzent text-akzent-text shadow-sm' : 'text-text'}`}
      onClick={() => setModus(m)}
    >
      {text}
    </button>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <header>
        <p className="text-4xl" aria-hidden="true">
          ❄️
        </p>
        <h1 className="mt-2 text-2xl font-bold">Willkommen bei Truhenblick</h1>
      </header>

      <div className="border-rand bg-karte flex gap-1 rounded-2xl border p-1" role="tablist" aria-label="Wie möchtest du beginnen?">
        {reiter('neu', 'Neue Truhe')}
        {reiter('beitreten', 'Einer Truhe beitreten')}
      </div>

      {modus === 'neu' ? (
        <NeueTruhe server={server} verbunden={verbunden} />
      ) : (
        <Beitreten server={server} verbunden={verbunden} zuNeu={() => setModus('neu')} />
      )}
    </main>
  );
}

function NeueTruhe({ server, verbunden }: { server: ServerInfo | null; verbunden: boolean }) {
  const [koerbe, setKoerbe] = useState(2);
  const [ebenen, setEbenen] = useState(2);
  const [faecher, setFaecher] = useState(1);
  const [speichert, setSpeichert] = useState(false);

  const konfig = useMemo<TruhenKonfig>(() => ({ koerbe, ebenen, faecherJeEbene: faecher }), [koerbe, ebenen, faecher]);
  const struktur = useMemo(() => baueStruktur(vorschauBereiche(konfig)), [konfig]);
  const mitCode = !verbunden && server?.da === true && server.neueTruhen;

  async function anlegen() {
    setSpeichert(true);
    try {
      if (mitCode) {
        try {
          // Erst die Truhe auf dem Server anlegen – der Aufbau folgt mit dem ersten Abgleich.
          await legeAnUndVerbinde('');
        } catch {
          // Server gerade nicht erreichbar: Die Truhe entsteht trotzdem, zunächst nur auf diesem Gerät.
          // Freigeben lässt sie sich später in den Einstellungen.
        }
      }
      await truheEinrichten(konfig);
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <>
      <p className="text-text2 -mt-2">
        Wie ist deine Gefriertruhe aufgebaut? Namen und Aufteilung kannst du später jederzeit in den Einstellungen ändern.
      </p>

      {verbunden && (
        <p className="border-akzent bg-akzent-weich rounded-2xl border p-3 text-sm" role="status">
          ✓ Verbunden. Die Truhe ist noch leer – lege jetzt ihren Aufbau fest.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Zahlwaehler
          name="Hängekörbe"
          hinweis="oben eingehängt"
          wert={koerbe}
          min={0}
          max={6}
          onChange={setKoerbe}
          anzeige={(n) => (n === 0 ? 'keine' : String(n))}
        />
        <Zahlwaehler name="Ebenen" hinweis="Schichten darunter, bis zum Boden" wert={ebenen} min={1} max={6} onChange={setEbenen} />
        <Zahlwaehler
          name="Fächer je Ebene"
          hinweis="z. B. links / rechts"
          wert={faecher}
          min={1}
          max={6}
          onChange={setFaecher}
          anzeige={(n) => (n === 1 ? 'keine' : String(n))}
        />
      </div>

      <section aria-label="Vorschau">
        <h2 className="text-text2 mb-1.5 text-sm font-medium">So sieht deine Truhe von oben aus</h2>
        <TruhenGrafik struktur={struktur} modus="vorschau" />
      </section>

      <div className="mt-auto flex flex-col gap-2">
        <button type="button" className="knopf knopf-primaer w-full" disabled={speichert} onClick={() => void anlegen()}>
          {speichert ? 'Lege an …' : 'Truhe anlegen'}
        </button>
        {mitCode && (
          <p className="text-text2 text-center text-sm">
            Dabei entsteht ein Code, mit dem weitere Geräte dieser Truhe beitreten können.
          </p>
        )}
        {!verbunden && server?.da && !server.neueTruhen && (
          <p className="text-text2 text-center text-sm">
            Auf diesem Server lassen sich keine neuen Truhen anlegen – die Truhe bleibt zunächst nur auf diesem Gerät.
          </p>
        )}
      </div>
    </>
  );
}

function Beitreten({ server, verbunden, zuNeu }: { server: ServerInfo | null; verbunden: boolean; zuNeu: () => void }) {
  const [code, setCode] = useState('');
  const [adresse, setAdresse] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  // Kommt die App nicht von einem Truhenblick-Server, muss dessen Adresse dazu.
  const brauchtAdresse = server !== null && !server.da;

  async function beitreten() {
    const ziel = normalisiereUrl(adresse);
    if (!code.trim()) {
      setFehler('Bitte gib den Code der Truhe ein.');
      return;
    }
    if (brauchtAdresse && !ziel) {
      setFehler('Bitte gib die Adresse eures Truhenblick-Servers ein.');
      return;
    }
    if (window.location.protocol === 'https:' && ziel.startsWith('http://')) {
      setFehler('Diese Seite läuft über https – der Server muss dann ebenfalls über https:// erreichbar sein.');
      return;
    }
    setFehler(null);
    setLaeuft(true);
    try {
      // Hat die Truhe schon einen Aufbau, erscheint sie nach dem Abgleich von selbst.
      await verbinde({ url: ziel === window.location.origin ? '' : ziel, token: code });
    } catch (e) {
      setFehler(e instanceof SyncFehler ? e.message : 'Der Beitritt ist fehlgeschlagen.');
    } finally {
      setLaeuft(false);
    }
  }

  if (verbunden) {
    return (
      <div className="karte flex flex-col gap-3 p-4" role="status">
        <p className="font-semibold">✓ Verbunden – aber diese Truhe ist noch leer.</p>
        <p className="text-text2 text-sm">
          Vielleicht hat das erste Gerät noch nicht abgeglichen. Sonst kannst du den Aufbau auch von hier aus festlegen.
        </p>
        <button type="button" className="knopf knopf-primaer" onClick={zuNeu}>
          Aufbau festlegen
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void beitreten();
      }}
    >
      <p className="text-text2 -mt-2">
        Gib den Code ein, den das erste Gerät beim Anlegen der Truhe bekommen hat. Dort steht er auch unter
        Einstellungen → Abgleich zwischen Geräten.
      </p>

      <div>
        <label className="beschriftung" htmlFor="beitritt-code">
          Code der Truhe
        </label>
        <CodeFeld id="beitritt-code" wert={code} onChange={setCode} platzhalter="xxxx-xxxx-xxxx-xxxx-xxxx" />
      </div>

      <details className="karte" open={brauchtAdresse}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
          {brauchtAdresse ? 'Adresse eures Servers' : 'Die Truhe liegt auf einem anderen Server?'}
        </summary>
        <div className="border-rand border-t p-4">
          <label className="beschriftung" htmlFor="beitritt-adresse">
            Adresse des Servers
          </label>
          <input
            id="beitritt-adresse"
            className="feld"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://truhe.example.de"
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
          />
          {!brauchtAdresse && <p className="text-text2 mt-1.5 text-sm">Leer lassen, wenn sie auf diesem Server liegt.</p>}
        </div>
      </details>

      {fehler && (
        <p className="border-ueber-rand bg-ueber-bg text-ueber-text rounded-2xl border p-3 text-sm font-medium" role="alert">
          {fehler}
        </p>
      )}

      <button type="submit" className="knopf knopf-primaer" disabled={laeuft}>
        {laeuft ? 'Trete bei …' : 'Beitreten'}
      </button>
    </form>
  );
}
