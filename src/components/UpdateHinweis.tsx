import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const PRUEF_INTERVALL_MS = 60 * 60 * 1000;

/**
 * Registriert den Service Worker und meldet sich,
 * wenn eine neue Version bereitliegt oder die App erstmals offline nutzbar ist.
 */
export function UpdateHinweis() {
  const {
    needRefresh: [neueVersion, setNeueVersion],
    offlineReady: [offlineBereit, setOfflineBereit],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registrierung) {
      if (!registrierung) return;
      // Eine installierte App bleibt oft tagelang offen – regelmäßig und beim Zurückkehren nachsehen.
      const pruefe = () => {
        if (navigator.onLine) void registrierung.update().catch(() => undefined);
      };
      setInterval(pruefe, PRUEF_INTERVALL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') pruefe();
      });
    },
  });

  useEffect(() => {
    if (!offlineBereit) return;
    const timer = setTimeout(() => setOfflineBereit(false), 6000);
    return () => clearTimeout(timer);
  }, [offlineBereit, setOfflineBereit]);

  if (!neueVersion && !offlineBereit) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-[70] flex justify-center px-3"
      role={neueVersion ? 'alert' : 'status'}
    >
      <div className="bg-text text-grund pointer-events-auto flex max-w-md items-center gap-1 rounded-2xl py-1.5 pr-1.5 pl-4 shadow-lg">
        {neueVersion ? (
          <>
            <span className="flex-1 py-2 text-[15px] leading-snug">Eine neue Version von Truhenblick ist da.</span>
            <button
              type="button"
              className="text-grund min-h-11 shrink-0 rounded-xl px-3 font-medium"
              onClick={() => setNeueVersion(false)}
            >
              Später
            </button>
            <button
              type="button"
              className="bg-grund text-text min-h-11 shrink-0 rounded-xl px-3 font-bold"
              onClick={() => void updateServiceWorker(true)}
            >
              Aktualisieren
            </button>
          </>
        ) : (
          <span className="py-2 pr-2.5 text-[15px] leading-snug">Truhenblick funktioniert jetzt auch ohne Internet.</span>
        )}
      </div>
    </div>
  );
}
