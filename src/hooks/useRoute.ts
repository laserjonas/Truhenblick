import { useMemo, useSyncExternalStore } from 'react';

export type Reiter = 'truhe' | 'liste' | 'bald' | 'einstellungen';

export type Route =
  | { seite: Reiter }
  | { seite: 'bereich'; id: string }
  | { seite: 'neu'; bereichId: string | null }
  | { seite: 'artikel'; id: string };

const REITER: readonly string[] = ['liste', 'bald', 'einstellungen'];

export function leseRoute(hash: string): Route {
  const [kopf, id] = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((t) => decodeURIComponent(t));
  if (kopf === 'bereich' && id) return { seite: 'bereich', id };
  if (kopf === 'artikel' && id) return { seite: 'artikel', id };
  if (kopf === 'neu') return { seite: 'neu', bereichId: id ?? null };
  if (kopf && REITER.includes(kopf)) return { seite: kopf as Reiter };
  return { seite: 'truhe' };
}

const lauscher = new Set<() => void>();

function benachrichtige(): void {
  for (const fn of lauscher) fn();
}

function abonniere(fn: () => void): () => void {
  lauscher.add(fn);
  window.addEventListener('popstate', fn);
  window.addEventListener('hashchange', fn);
  return () => {
    lauscher.delete(fn);
    window.removeEventListener('popstate', fn);
    window.removeEventListener('hashchange', fn);
  };
}

function tiefe(): number {
  const zustand = history.state as { tiefe?: number } | null;
  return zustand?.tiefe ?? 0;
}

/** Öffnet eine Unterseite („/bereich/abc“). Der Zurück-Knopf des Geräts schließt sie wieder. */
export function gehe(pfad: string): void {
  history.pushState({ tiefe: tiefe() + 1 }, '', `#${pfad}`);
  benachrichtige();
}

/** Wechselt die Ansicht, ohne einen Verlaufseintrag anzulegen (Reiterwechsel). */
export function ersetze(pfad: string): void {
  history.replaceState({ tiefe: tiefe() }, '', `#${pfad}`);
  benachrichtige();
}

/** Schließt die aktuelle Unterseite. */
export function zurueck(): void {
  if (tiefe() > 0) history.back();
  else ersetze('/');
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(abonniere, () => window.location.hash);
  return useMemo(() => leseRoute(hash), [hash]);
}
