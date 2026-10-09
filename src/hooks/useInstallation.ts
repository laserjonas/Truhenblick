import { useSyncExternalStore } from 'react';

/** Das Ereignis, mit dem Chromium-Browser die Installation anbieten (nicht in den Standard-Typen enthalten). */
interface InstallEreignis extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface Installation {
  /** Läuft bereits als installierte App */
  installiert: boolean;
  /** Der Browser bietet einen Installationsdialog an (Android, Desktop-Chromium) */
  angebot: boolean;
  /** iPhone/iPad: nur über „Teilen → Zum Home-Bildschirm“ */
  ios: boolean;
  /** Ohne HTTPS (außer localhost) lässt sich keine PWA installieren */
  sicher: boolean;
}

let ereignis: InstallEreignis | null = null;
let installiertGemeldet = false;
const lauscher = new Set<() => void>();

function melde(): void {
  stand = berechne();
  for (const fn of lauscher) fn();
}

function istStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function istIos(): boolean {
  // iPadOS gibt sich als Mac aus, hat aber einen Touchscreen.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function berechne(): Installation {
  return {
    installiert: installiertGemeldet || istStandalone(),
    angebot: ereignis !== null,
    ios: istIos(),
    sicher: window.isSecureContext,
  };
}

let stand: Installation = berechne();

// Das Ereignis kann schon vor dem ersten Rendern eintreffen – deshalb gleich beim Laden lauschen.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ereignis = e as InstallEreignis;
  melde();
});
window.addEventListener('appinstalled', () => {
  ereignis = null;
  installiertGemeldet = true;
  melde();
});
window.matchMedia('(display-mode: standalone)').addEventListener('change', melde);

/** Zeigt den Installationsdialog des Browsers. Liefert true, wenn installiert wurde. */
export async function installiere(): Promise<boolean> {
  if (!ereignis) return false;
  const e = ereignis;
  await e.prompt();
  const { outcome } = await e.userChoice;
  ereignis = null;
  melde();
  return outcome === 'accepted';
}

export function useInstallation(): Installation {
  return useSyncExternalStore(
    (fn) => {
      lauscher.add(fn);
      return () => lauscher.delete(fn);
    },
    () => stand,
  );
}
