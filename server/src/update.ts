import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateStand } from '../../shared/types.ts';

/**
 * Aktualisierung des Servers aus der App heraus.
 *
 * Das Backend läuft ohne besondere Rechte und führt das Update NICHT selbst aus.
 * Es legt nur eine Anfragedatei in sein Datenverzeichnis. Ein systemd-Dienst
 * (truhenblick-update.path/.service, von der Einrichtung angelegt) bemerkt sie
 * und startet als root das feste Skript truhenblick-update – ohne Parameter aus
 * der Anfrage. Den Fortschritt schreibt das Skript in ein Verzeichnis, das dem
 * Backend nur zum Lesen offensteht.
 *
 * Wo diese Einrichtung fehlt (Docker, eigene Setups), meldet der Stand
 * `moeglich: false` und die App zeigt, wie man von Hand aktualisiert.
 */

export interface UpdateOrte {
  /** Von der Einrichtung geschrieben: TB_REPO, TB_BRANCH */
  konfDatei: string;
  /** Git-Commit der installierten Version */
  versionDatei: string;
  /** status.json und update.log des Update-Dienstes (für das Backend nur lesbar) */
  statusVerzeichnis: string;
  /** Diese Datei stößt das Update an */
  anfrageDatei: string;
}

export const STANDARD_ORTE = (datenVerzeichnis: string): UpdateOrte => ({
  konfDatei: '/etc/truhenblick/install.conf',
  versionDatei: '/etc/truhenblick/version',
  statusVerzeichnis: '/var/lib/truhenblick-update',
  anfrageDatei: join(datenVerzeichnis, 'update-anfrage'),
});

export interface UpdateDienst {
  /** `pruefen` fragt die Quelle sofort ab, sonst höchstens alle paar Minuten. */
  stand(pruefen: boolean): Promise<UpdateStand>;
  starte(): Promise<'gestartet' | 'laeuft' | 'nicht-moeglich'>;
}

/** Liefert den neuesten Commit des Zweigs oder null, wenn die Quelle nicht erreichbar ist. */
export type HoleRemote = (repo: string, zweig: string) => Promise<string | null>;

const COMMIT = /^[0-9a-f]{40}$/;
const PRUEFUNG_GILT_MS = 5 * 60 * 1000;
/** Ein „läuft“ ohne Abschluss gilt nach dieser Zeit als hängengeblieben. */
const LAEUFT_HOECHSTENS_MS = 30 * 60 * 1000;
const PROTOKOLL_ZEILEN = 40;

export const holeRemotePerGit: HoleRemote = (repo, zweig) =>
  new Promise((fertig) => {
    // Feste Argumente, keine Shell; „--“ verhindert, dass eine Adresse als Option gelesen wird.
    execFile(
      'git',
      ['ls-remote', '--heads', '--', repo, `refs/heads/${zweig}`],
      { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (fehler, ausgabe) => {
        const commit = fehler ? '' : (ausgabe.split(/\s/)[0] ?? '');
        fertig(COMMIT.test(commit) ? commit : null);
      },
    );
  });

async function lies(datei: string): Promise<string | null> {
  try {
    return await readFile(datei, 'utf8');
  } catch {
    return null;
  }
}

/** Gibt es die Datei und ist sie jünger als die Höchstdauer eines Updates? */
async function frisch(datei: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(datei)).mtimeMs < LAEUFT_HOECHSTENS_MS;
  } catch {
    return false;
  }
}

function wertAus(konf: string, name: string): string | null {
  return konf.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
}

interface StatusDatei {
  zustand?: unknown;
  gestartet?: unknown;
  beendet?: unknown;
  meldung?: unknown;
}

export function erstelleUpdateDienst(orte: UpdateOrte, holeRemote: HoleRemote = holeRemotePerGit): UpdateDienst {
  let pruefung: { commit: string | null; zeit: number; fuer: string } | null = null;

  const eingerichtet = () => existsSync(orte.konfDatei) && existsSync(orte.statusVerzeichnis);

  async function leseStatus(): Promise<{ laeuft: boolean; letztes: UpdateStand['letztes'] }> {
    const roh = await lies(join(orte.statusVerzeichnis, 'status.json'));
    let status: StatusDatei = {};
    try {
      if (roh) status = JSON.parse(roh) as StatusDatei;
    } catch {
      // Datei wird gerade geschrieben oder ist unlesbar – wie „kein Status“ behandeln.
    }
    // „Unterwegs“ heißt: Anfrage liegt noch da – oder der Update-Dienst hat seine Markierung gesetzt
    // (das tut er, bevor er die Anfrage entfernt; so gibt es keinen Moment, in dem beides fehlt).
    const angefragt = existsSync(orte.anfrageDatei) || (await frisch(join(orte.statusVerzeichnis, 'laeuft')));
    const gestartet = typeof status.gestartet === 'string' ? Date.parse(status.gestartet) : Number.NaN;
    const laeuftLautStatus =
      status.zustand === 'laeuft' && Number.isFinite(gestartet) && Date.now() - gestartet < LAEUFT_HOECHSTENS_MS;
    const zustand = status.zustand === 'fertig' || status.zustand === 'fehler' ? status.zustand : null;
    const letztes: UpdateStand['letztes'] =
      zustand && typeof status.beendet === 'string' && typeof status.meldung === 'string'
        ? { zustand, beendet: status.beendet, meldung: status.meldung }
        : null;
    return { laeuft: angefragt || laeuftLautStatus, letztes: angefragt || laeuftLautStatus ? null : letztes };
  }

  async function stand(pruefen: boolean): Promise<UpdateStand> {
    if (!eingerichtet()) {
      return {
        moeglich: false,
        grund: 'nicht-eingerichtet',
        installiert: null,
        verfuegbar: null,
        neu: null,
        geprueft: null,
        laeuft: false,
        letztes: null,
        protokoll: null,
      };
    }

    const konf = (await lies(orte.konfDatei)) ?? '';
    const repo = wertAus(konf, 'TB_REPO');
    const zweig = wertAus(konf, 'TB_BRANCH') ?? 'main';
    const installiertRoh = ((await lies(orte.versionDatei)) ?? '').trim();
    const installiert = COMMIT.test(installiertRoh) ? installiertRoh : null;
    const { laeuft, letztes } = await leseStatus();

    // Während eines Updates nicht nachfragen: Der Stand ändert sich gerade.
    const quelle = `${repo}#${zweig}`;
    const veraltet = !pruefung || pruefung.fuer !== quelle || Date.now() - pruefung.zeit > PRUEFUNG_GILT_MS;
    if (repo && !laeuft && (pruefen || veraltet)) {
      pruefung = { commit: await holeRemote(repo, zweig), zeit: Date.now(), fuer: quelle };
    }
    const verfuegbar = pruefung?.fuer === quelle ? pruefung.commit : null;

    let protokoll: string | null = null;
    if (letztes?.zustand === 'fehler') {
      const log = await lies(join(orte.statusVerzeichnis, 'update.log'));
      // Farbcodes des Skripts stören in der App.
      if (log) protokoll = log.replace(/\u001b\[[0-9;]*m/g, '').trimEnd().split('\n').slice(-PROTOKOLL_ZEILEN).join('\n');
    }

    return {
      moeglich: true,
      installiert,
      verfuegbar,
      neu: verfuegbar && installiert ? verfuegbar !== installiert : null,
      geprueft: pruefung?.fuer === quelle ? new Date(pruefung.zeit).toISOString() : null,
      laeuft,
      letztes,
      protokoll,
    };
  }

  async function starte(): Promise<'gestartet' | 'laeuft' | 'nicht-moeglich'> {
    if (!eingerichtet()) return 'nicht-moeglich';
    if ((await leseStatus()).laeuft) return 'laeuft';
    try {
      // Der Inhalt ist ohne Bedeutung – der Update-Dienst liest ihn nicht.
      // „wx“: Von mehreren gleichzeitigen Anfragen legt genau eine die Datei an.
      await writeFile(orte.anfrageDatei, `${new Date().toISOString()}\n`, { mode: 0o600, flag: 'wx' });
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code === 'EEXIST') return 'laeuft';
      throw fehler;
    }
    // Danach gilt die letzte Prüfung nicht mehr.
    pruefung = null;
    return 'gestartet';
  }

  return { stand, starte };
}
