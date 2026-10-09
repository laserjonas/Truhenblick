import { useState } from 'react';
import type { Bereich, BereichTyp } from '../../shared/types.ts';
import { HochIcon, PapierkorbIcon, PlusIcon, RunterIcon } from '../components/Icons.tsx';
import { useSnackbar } from '../components/Snackbar.tsx';
import {
  artikelImBereich,
  bereichAnlegen,
  bereichLoeschen,
  bereichUmbenennen,
  bereichVerschieben,
} from '../db/repo.ts';
import { useDaten } from '../hooks/useDaten.tsx';

const NEUER_NAME: Record<BereichTyp, string> = { korb: 'Korb', ebene: 'Ebene', fach: 'Fach' };

function Zeile({
  bereich,
  erster,
  letzter,
  einzigerBereich,
  eingerueckt = false,
}: {
  bereich: Bereich;
  erster: boolean;
  letzter: boolean;
  einzigerBereich: boolean;
  eingerueckt?: boolean;
}) {
  const zeige = useSnackbar();
  const [name, setName] = useState(bereich.name);
  const [vorlage, setVorlage] = useState(bereich.name);

  // Wurde der Name anderswo geändert (z. B. durch den Abgleich), übernimmt das Feld ihn.
  if (bereich.name !== vorlage) {
    setVorlage(bereich.name);
    setName(bereich.name);
  }

  async function loeschen() {
    const anzahl = await artikelImBereich(bereich.id);
    if (anzahl > 0) {
      zeige({
        text: `„${bereich.name}“ enthält noch ${anzahl === 1 ? '1 Artikel' : `${anzahl} Artikel`}. Bitte erst umräumen oder entnehmen.`,
      });
      return;
    }
    if (await bereichLoeschen(bereich.id)) zeige({ text: `„${bereich.name}“ gelöscht` });
  }

  return (
    <li className={`flex items-center gap-0.5 ${eingerueckt ? 'pl-5' : ''}`}>
      <input
        className="feld min-h-11 min-w-0 flex-1 px-3"
        type="text"
        maxLength={80}
        aria-label={`Name von ${bereich.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== bereich.name) void bereichUmbenennen(bereich.id, name);
          else setName(bereich.name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className="rund"
        aria-label={`${bereich.name} nach vorne`}
        disabled={erster}
        onClick={() => void bereichVerschieben(bereich.id, -1)}
      >
        <HochIcon width={20} height={20} />
      </button>
      <button
        type="button"
        className="rund"
        aria-label={`${bereich.name} nach hinten`}
        disabled={letzter}
        onClick={() => void bereichVerschieben(bereich.id, 1)}
      >
        <RunterIcon width={20} height={20} />
      </button>
      <button
        type="button"
        className="rund text-gefahr"
        aria-label={`${bereich.name} löschen`}
        disabled={einzigerBereich}
        onClick={() => void loeschen()}
      >
        <PapierkorbIcon width={20} height={20} />
      </button>
    </li>
  );
}

function Hinzufuegen({ typ, parentId = null, anzahl }: { typ: BereichTyp; parentId?: string | null; anzahl: number }) {
  return (
    <button
      type="button"
      className={`text-akzent active:bg-akzent-weich flex min-h-11 items-center gap-1.5 self-start rounded-xl px-2 text-sm font-semibold ${
        parentId ? 'ml-5' : ''
      }`}
      onClick={() => void bereichAnlegen(`${NEUER_NAME[typ]} ${anzahl + 1}`, typ, parentId)}
    >
      <PlusIcon width={18} height={18} />
      {NEUER_NAME[typ]} hinzufügen
    </button>
  );
}

/** Bereiche der Truhe umbenennen, umsortieren, ergänzen und löschen. */
export function TruheBearbeiten() {
  const { struktur, bereiche } = useDaten();
  const einziger = bereiche.length <= 1;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="tb-koerbe">
        <h3 id="tb-koerbe" className="beschriftung">
          Hängekörbe
        </h3>
        <ul className="flex flex-col gap-1.5">
          {struktur.koerbe.map((k, i) => (
            <Zeile
              key={k.id}
              bereich={k}
              erster={i === 0}
              letzter={i === struktur.koerbe.length - 1}
              einzigerBereich={einziger}
            />
          ))}
        </ul>
        <Hinzufuegen typ="korb" anzahl={struktur.koerbe.length} />
      </section>

      <section aria-labelledby="tb-ebenen">
        <h3 id="tb-ebenen" className="beschriftung">
          Ebenen und ihre Fächer (von oben nach unten)
        </h3>
        <ul className="flex flex-col gap-1.5">
          {struktur.ebenen.map(({ ebene, faecher }, i) => (
            <li key={ebene.id} className="flex flex-col gap-1.5">
              <ul className="flex flex-col gap-1.5">
                <Zeile
                  bereich={ebene}
                  erster={i === 0}
                  letzter={i === struktur.ebenen.length - 1}
                  einzigerBereich={einziger}
                />
                {faecher.map((f, j) => (
                  <Zeile
                    key={f.id}
                    bereich={f}
                    erster={j === 0}
                    letzter={j === faecher.length - 1}
                    einzigerBereich={einziger}
                    eingerueckt
                  />
                ))}
              </ul>
              {ebene.typ === 'ebene' && <Hinzufuegen typ="fach" parentId={ebene.id} anzahl={faecher.length} />}
            </li>
          ))}
        </ul>
        <Hinzufuegen typ="ebene" anzahl={struktur.ebenen.length} />
      </section>
    </div>
  );
}
