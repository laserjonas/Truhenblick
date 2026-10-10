import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.ts';
import { CODE_HINWEIS, merkeCodeHinweis } from '../sync/client.ts';
import { CodeAnzeige } from './CodeAnzeige.tsx';

interface Konfig {
  token?: string;
}

/**
 * Nach dem Anlegen einer Truhe: zeigt einmal groß den Code, mit dem weitere Geräte beitreten.
 * Bleibt stehen, bis man „Verstanden“ antippt – auch über einen Neustart der App hinweg.
 */
export function NeueTruheHinweis() {
  const code = useLiveQuery(async () => {
    if (!(await db.meta.get(CODE_HINWEIS))?.value) return null;
    return ((await db.meta.get('sync.konfig'))?.value as Konfig | undefined)?.token ?? null;
  }, []);

  if (!code) return null;

  return (
    <aside className="border-akzent bg-akzent-weich flex flex-col gap-3 rounded-2xl border p-3 sm:p-4" aria-label="Code für weitere Geräte">
      <div>
        <p className="font-bold">✓ Deine Truhe ist angelegt</p>
        <p className="mt-0.5 text-sm">
          Mit diesem Code treten weitere Geräte bei – dort beim ersten Start <strong>„Einer Truhe beitreten“</strong>{' '}
          wählen.
        </p>
      </div>
      <CodeAnzeige code={code} />
      <p className="text-sm">Du findest den Code jederzeit unter Einstellungen → Abgleich zwischen Geräten.</p>
      <button type="button" className="knopf knopf-primaer" onClick={() => void merkeCodeHinweis(false)}>
        Verstanden
      </button>
    </aside>
  );
}
