import { istNeuereVersion } from '../logic/appVersion.ts';

/**
 * Liegt auf dem Server eine neuere App als die gerade geladene?
 * Funktioniert auch ohne Service Worker (z. B. über http im Heimnetz).
 * null = nicht feststellbar (offline).
 */
export async function neueAppVersionVorhanden(): Promise<boolean | null> {
  const geladen = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  try {
    // Der Zusatz an der Adresse führt am Zwischenspeicher des Service Workers vorbei.
    const antwort = await fetch(`/index.html?frisch=${Date.now()}`, { cache: 'no-store' });
    if (!antwort.ok) return null;
    return istNeuereVersion(geladen, await antwort.text());
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise<void>((fertig) => setTimeout(fertig, ms));

/** Wartet, bis ein gerade geladener Service Worker bereitsteht. */
function bereitstehender(registrierung: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  return new Promise((fertig) => {
    const neu = registrierung.installing;
    if (!neu) {
      fertig(registrierung.waiting);
      return;
    }
    neu.addEventListener('statechange', () => {
      if (neu.state === 'installed') fertig(neu);
      else if (neu.state === 'redundant') fertig(null);
    });
    setTimeout(() => fertig(registrierung.waiting), 20_000);
  });
}

/**
 * Lädt die App in der neuesten Version neu. Mit Service Worker wird erst der neue Stand
 * geholt und aktiviert – ein einfaches Neuladen käme sonst wieder aus dem Zwischenspeicher.
 */
export async function ladeNeueAppVersion(): Promise<void> {
  try {
    const registrierung = await navigator.serviceWorker?.getRegistration();
    if (registrierung) {
      await registrierung.update();
      const wartend = registrierung.waiting ?? (await bereitstehender(registrierung));
      if (wartend) {
        const uebernommen = new Promise<void>((fertig) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => fertig(), { once: true }),
        );
        wartend.postMessage({ type: 'SKIP_WAITING' });
        await Promise.race([uebernommen, pause(4000)]);
      }
    }
  } catch {
    // Dann eben ohne – das Neuladen holt zumindest die Startseite frisch.
  }
  window.location.reload();
}
