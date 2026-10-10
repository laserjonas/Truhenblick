import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Kürzer wäre zu leicht zu erraten – der Server ist womöglich aus dem Internet erreichbar. */
export const MIN_PASSWORT_LAENGE = 8;
export const MAX_PASSWORT_LAENGE = 200;

// scrypt mit den üblichen Kosten (rund 16 MB Speicher je Prüfung)
const N = 16384;
const R = 8;
const P = 1;
const SCHLUESSEL_BYTES = 32;

function leiteAb(passwort: string, salz: Buffer, n: number, r: number, p: number, laenge: number): Promise<Buffer> {
  return new Promise((ok, fehler) => {
    scrypt(passwort.normalize('NFKC'), salz, laenge, { N: n, r, p }, (e, schluessel) => (e ? fehler(e) : ok(schluessel)));
  });
}

/** Prüfsumme zum Speichern: „scrypt$N$r$p$Salz$Schlüssel“ – das Passwort selbst liegt nirgends. */
export async function passwortHash(passwort: string): Promise<string> {
  const salz = randomBytes(16);
  const schluessel = await leiteAb(passwort, salz, N, R, P, SCHLUESSEL_BYTES);
  return ['scrypt', N, R, P, salz.toString('base64'), schluessel.toString('base64')].join('$');
}

export async function passwortStimmt(passwort: string, gespeichert: string): Promise<boolean> {
  const [art, n, r, p, salz, soll] = gespeichert.split('$');
  if (art !== 'scrypt' || !salz || !soll) return false;
  const erwartet = Buffer.from(soll, 'base64');
  try {
    const ist = await leiteAb(passwort, Buffer.from(salz, 'base64'), Number(n), Number(r), Number(p), erwartet.length);
    return timingSafeEqual(ist, erwartet);
  } catch {
    return false;
  }
}

/** Kennung einer Anmeldung auf einem Gerät: 256 Bit Zufall. */
export function erzeugeSitzung(): string {
  return `sitz-${randomBytes(32).toString('base64url')}`;
}
