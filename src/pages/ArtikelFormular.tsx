import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import type { Artikel } from '../../shared/types.ts';
import { Blatt } from '../components/Blatt.tsx';
import { MinusIcon, PlusIcon } from '../components/Icons.tsx';
import { KategorieFilter } from '../components/KategorieFilter.tsx';
import { useSnackbar } from '../components/Snackbar.tsx';
import { TruhenGrafik } from '../components/TruhenGrafik.tsx';
import { EINHEITEN, einheitInfo } from '../config/einheiten.ts';
import { kategorieInfo, STICHWOERTER } from '../config/kategorien.ts';
import { db } from '../db/db.ts';
import { artikelAendern, artikelAnlegen, artikelWiederherstellen, type ArtikelEingabe } from '../db/repo.ts';
import { useArtikelAktionen } from '../hooks/useArtikelAktionen.ts';
import { useArtikelJeBereich, useDaten } from '../hooks/useDaten.tsx';
import { zurueck } from '../hooks/useRoute.ts';
import { addMonate, datumAnzeige } from '../logic/datum.ts';
import { monateText } from '../logic/haltbarkeit.ts';
import { normalisiere, vorschlagFuer } from '../logic/vorschlag.ts';

interface Props {
  /** Vorhandener Artikel (Bearbeiten) oder null (Neu) */
  artikel: Artikel | null;
  /** Vorbelegter Bereich beim Anlegen */
  startBereichId: string | null;
}

function leseMenge(text: string): number {
  return Number(text.replace(',', '.'));
}

/** Emojis zur Auswahl: das der Kategorie und die ihrer Stichwörter. */
function emojiAuswahl(kategorie: string): string[] {
  const liste = [kategorieInfo(kategorie).emoji];
  for (const s of STICHWOERTER) {
    if (s.kategorie === kategorie && s.emoji && !liste.includes(s.emoji)) liste.push(s.emoji);
  }
  return liste;
}

/**
 * Schnellerfassung und Bearbeiten in einem: Name tippen, Bereich antippen, speichern.
 * Kategorie, Emoji, Einheit und Haltbarkeit folgen dem Namen, bis man sie selbst festlegt.
 */
export function ArtikelFormular({ artikel, startBereichId }: Props) {
  const { bereiche, struktur, heute, artikel: alleArtikel } = useDaten();
  const zeige = useSnackbar();
  const aktionen = useArtikelAktionen();
  const jeBereich = useArtikelJeBereich(alleArtikel);
  const nameFeld = useRef<HTMLInputElement>(null);
  const bereichAbschnitt = useRef<HTMLElement>(null);

  // Auch bereits entnommene Artikel liefern Vorschläge.
  const historie = useLiveQuery(() => db.artikel.toArray(), []);

  const [name, setName] = useState(artikel?.name ?? '');
  const [bereichId, setBereichId] = useState<string | null>(() => {
    const start = artikel?.bereichId ?? startBereichId;
    return start && bereiche.some((b) => b.id === start) ? start : null;
  });
  const [mengeText, setMengeText] = useState(artikel ? String(artikel.menge).replace('.', ',') : '1');
  const [eingefrorenAm, setEingefrorenAm] = useState(artikel?.eingefrorenAm ?? heute);
  const [notiz, setNotiz] = useState(artikel?.notiz ?? '');
  // „Manuell“ = selbst festgelegt; null = folgt dem Vorschlag.
  const [kategorieManuell, setKategorieManuell] = useState<string | null>(artikel?.kategorie ?? null);
  const [emojiManuell, setEmojiManuell] = useState<string | null>(artikel?.emoji ?? null);
  const [einheitManuell, setEinheitManuell] = useState<string | null>(artikel?.einheit ?? null);
  const [haltbarManuell, setHaltbarManuell] = useState<string | null>(artikel?.haltbarBis ?? null);
  const [fehler, setFehler] = useState<'name' | 'bereich' | 'menge' | null>(null);

  const vorschlag = useMemo(() => vorschlagFuer(name, historie ?? []), [name, historie]);
  const kategorie = kategorieManuell ?? vorschlag.kategorie;
  const kategorieGewaehlt = kategorieManuell !== null && kategorieManuell !== vorschlag.kategorie;
  const haltbarMonate = kategorieGewaehlt ? kategorieInfo(kategorie).haltbarMonate : vorschlag.haltbarMonate;
  const emoji = emojiManuell ?? (kategorieGewaehlt ? kategorieInfo(kategorie).emoji : vorschlag.emoji);
  const einheit = einheitManuell ?? vorschlag.einheit;
  const haltbarVorschlag = addMonate(eingefrorenAm || heute, haltbarMonate);
  const haltbarBis = haltbarManuell ?? haltbarVorschlag;

  const namen = useMemo(() => {
    const gesehen = new Set<string>();
    const liste: string[] = [];
    for (const a of [...(historie ?? [])].sort((x, y) => y.geaendertAm.localeCompare(x.geaendertAm))) {
      const schluessel = normalisiere(a.name).trim();
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      liste.push(a.name);
      if (liste.length >= 150) break;
    }
    return liste;
  }, [historie]);

  function aendereMenge(richtung: -1 | 1) {
    const schritt = einheitInfo(einheit).schritt;
    const aktuell = leseMenge(mengeText);
    const basis = Number.isFinite(aktuell) ? aktuell : 0;
    const neu = Math.max(schritt, Math.round((basis + richtung * schritt) * 1000) / 1000);
    setMengeText(String(neu).replace('.', ','));
  }

  function pruefe(): ArtikelEingabe | null {
    const menge = leseMenge(mengeText);
    if (!name.trim()) {
      setFehler('name');
      nameFeld.current?.focus();
      return null;
    }
    if (!Number.isFinite(menge) || menge <= 0) {
      setFehler('menge');
      return null;
    }
    if (!bereichId) {
      setFehler('bereich');
      bereichAbschnitt.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    setFehler(null);
    return {
      name: name.trim(),
      kategorie,
      emoji: emoji.trim() || kategorieInfo(kategorie).emoji,
      menge,
      einheit,
      eingefrorenAm: eingefrorenAm || heute,
      haltbarBis,
      bereichId,
      notiz: notiz.trim(),
    };
  }

  function ortName(id: string): string {
    const b = bereiche.find((x) => x.id === id);
    if (!b) return '';
    const eltern = b.parentId ? bereiche.find((x) => x.id === b.parentId) : undefined;
    return eltern ? `${eltern.name} › ${b.name}` : b.name;
  }

  async function speichern(weiter: boolean) {
    const eingabe = pruefe();
    if (!eingabe) return;
    if (artikel) {
      await artikelAendern(artikel.id, eingabe);
      const verschoben = artikel.bereichId !== eingabe.bereichId;
      zeige({
        text: verschoben ? `${eingabe.emoji} ${eingabe.name} liegt jetzt in ${ortName(eingabe.bereichId)}` : 'Gespeichert',
        aktion: { name: 'Rückgängig', ausfuehren: () => artikelWiederherstellen(artikel) },
      });
      zurueck();
      return;
    }
    await artikelAnlegen(eingabe);
    zeige({ text: `${eingabe.emoji} ${eingabe.name} in ${ortName(eingabe.bereichId)} eingelagert` });
    if (!weiter) {
      zurueck();
      return;
    }
    // Für den nächsten Artikel bleiben Bereich und Einfrierdatum stehen.
    setName('');
    setMengeText('1');
    setNotiz('');
    setKategorieManuell(null);
    setEmojiManuell(null);
    setEinheitManuell(null);
    setHaltbarManuell(null);
    nameFeld.current?.focus();
  }

  async function entnehmen() {
    if (!artikel) return;
    await aktionen.entnehmen(artikel);
    zurueck();
  }

  return (
    <Blatt
      titel={artikel ? 'Artikel bearbeiten' : 'Artikel einlagern'}
      fuss={
        <>
          {artikel ? (
            <button type="button" className="knopf knopf-gefahr flex-1" onClick={() => void entnehmen()}>
              Entnehmen
            </button>
          ) : (
            <button type="button" className="knopf knopf-leise flex-1 px-3" onClick={() => void speichern(true)}>
              + Weiterer
            </button>
          )}
          <button type="submit" form="artikel-formular" className="knopf knopf-primaer flex-[1.4]">
            Speichern
          </button>
        </>
      }
    >
      <form
        id="artikel-formular"
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void speichern(false);
        }}
      >
        <div>
          <label className="beschriftung" htmlFor="artikel-name">
            Was lagerst du ein?
          </label>
          <div className="flex gap-2">
            <span
              className="border-rand bg-karte flex size-12 shrink-0 items-center justify-center rounded-2xl border text-2xl"
              aria-hidden="true"
            >
              {emoji}
            </span>
            <input
              id="artikel-name"
              ref={nameFeld}
              className={`feld ${fehler === 'name' ? 'border-gefahr' : ''}`}
              type="text"
              list="artikel-namen"
              placeholder="z. B. Hackfleisch"
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="done"
              maxLength={120}
              autoFocus={!artikel}
              aria-invalid={fehler === 'name'}
              aria-describedby={fehler === 'name' ? 'fehler-name' : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fehler === 'name') setFehler(null);
              }}
            />
            <datalist id="artikel-namen">
              {namen.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          {fehler === 'name' && (
            <p id="fehler-name" className="text-gefahr mt-1.5 text-sm font-medium" role="alert">
              Bitte gib einen Namen ein.
            </p>
          )}
        </div>

        <div>
          <span className="beschriftung" id="kategorie-label">
            Kategorie
            {kategorieManuell === null && name.trim() !== '' && vorschlag.quelle !== 'standard' && (
              <span className="font-normal"> · vorgeschlagen</span>
            )}
          </span>
          <KategorieFilter
            wert={kategorie}
            onChange={(k) => setKategorieManuell(k)}
            beschriftung="Kategorie wählen"
          />
        </div>

        <section ref={bereichAbschnitt} aria-labelledby="bereich-label">
          <span className="beschriftung" id="bereich-label">
            Wohin? <span className="font-normal">Tippe auf den Platz in der Truhe.</span>
          </span>
          <TruhenGrafik
            struktur={struktur}
            jeBereich={jeBereich}
            modus="auswahl"
            ausgewaehlt={bereichId}
            onBereich={(id) => {
              setBereichId(id);
              if (fehler === 'bereich') setFehler(null);
            }}
          />
          {fehler === 'bereich' && (
            <p className="text-gefahr mt-1.5 text-sm font-medium" role="alert">
              Bitte wähle einen Platz in der Truhe.
            </p>
          )}
        </section>

        <div>
          <label className="beschriftung" htmlFor="artikel-menge">
            Menge
          </label>
          <div className="flex items-center gap-1.5">
            <button type="button" className="rund border-rand bg-karte size-12 border" aria-label="Menge verringern" onClick={() => aendereMenge(-1)}>
              <MinusIcon />
            </button>
            <input
              id="artikel-menge"
              className={`feld w-20 px-2 text-center font-bold tabular-nums ${fehler === 'menge' ? 'border-gefahr' : ''}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={fehler === 'menge'}
              value={mengeText}
              onChange={(e) => {
                setMengeText(e.target.value);
                if (fehler === 'menge') setFehler(null);
              }}
            />
            <button type="button" className="rund border-rand bg-karte size-12 border" aria-label="Menge erhöhen" onClick={() => aendereMenge(1)}>
              <PlusIcon />
            </button>
            <select
              className="feld min-w-0 flex-1"
              aria-label="Einheit"
              value={einheit}
              onChange={(e) => setEinheitManuell(e.target.value)}
            >
              {EINHEITEN.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          {fehler === 'menge' && (
            <p className="text-gefahr mt-1.5 text-sm font-medium" role="alert">
              Bitte gib eine Menge größer als 0 ein.
            </p>
          )}
        </div>

        <details className="karte group" open={artikel !== null}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Haltbarkeit & Details</span>
              <span className="text-text2 block truncate text-sm">
                haltbar bis {datumAnzeige(haltbarBis)}
                {haltbarManuell === null && ` (${monateText(haltbarMonate)})`}
              </span>
            </span>
            <span className="text-text2 text-sm group-open:hidden">anpassen</span>
          </summary>
          <div className="border-rand flex flex-col gap-4 border-t p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="beschriftung" htmlFor="artikel-eingefroren">
                  Eingefroren am
                </label>
                <input
                  id="artikel-eingefroren"
                  className="feld px-3"
                  type="date"
                  max={heute}
                  value={eingefrorenAm}
                  onChange={(e) => setEingefrorenAm(e.target.value)}
                />
              </div>
              <div>
                <label className="beschriftung" htmlFor="artikel-haltbar">
                  Haltbar bis
                </label>
                <input
                  id="artikel-haltbar"
                  className="feld px-3"
                  type="date"
                  value={haltbarBis}
                  onChange={(e) => setHaltbarManuell(e.target.value || null)}
                />
              </div>
            </div>
            <p className="text-text2 -mt-2 text-sm">
              Vorschlag für {kategorieInfo(kategorie).name}: {monateText(haltbarMonate)} ({datumAnzeige(haltbarVorschlag)}
              ).{' '}
              {haltbarManuell !== null && haltbarManuell !== haltbarVorschlag && (
                <button type="button" className="text-akzent font-semibold underline" onClick={() => setHaltbarManuell(null)}>
                  Vorschlag übernehmen
                </button>
              )}
            </p>

            <div>
              <label className="beschriftung" htmlFor="artikel-emoji">
                Symbol
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  id="artikel-emoji"
                  className="feld w-16 px-0 text-center text-2xl"
                  type="text"
                  maxLength={8}
                  autoComplete="off"
                  value={emoji}
                  onChange={(e) => setEmojiManuell(e.target.value)}
                />
                {emojiAuswahl(kategorie).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`rund border text-2xl ${e === emoji ? 'border-akzent bg-akzent-weich' : 'border-rand bg-karte'}`}
                    aria-label={`Symbol ${e}`}
                    aria-pressed={e === emoji}
                    onClick={() => setEmojiManuell(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="beschriftung" htmlFor="artikel-notiz">
                Notiz
              </label>
              <textarea
                id="artikel-notiz"
                className="feld py-3"
                rows={2}
                maxLength={2000}
                placeholder="z. B. vom Hofladen, für Lasagne"
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
              />
            </div>

            {artikel && (
              <p className="text-text2 text-sm">Erfasst am {datumAnzeige(artikel.erstelltAm.slice(0, 10))}</p>
            )}
          </div>
        </details>
      </form>
    </Blatt>
  );
}
