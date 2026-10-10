/**
 * Woher kommt eine Anfrage wirklich?
 *
 * Das Backend sieht als Gegenstelle immer nur den eigenen Webserver (Caddy). Der trägt die Adresse
 * seiner Gegenstelle in X-Forwarded-For ein – das ist das Gerät selbst oder ein vorgeschalteter
 * Reverse Proxy (z. B. Nginx Proxy Manager), der seinerseits die Adresse des Geräts davor schreibt.
 * Alles weiter links in der Liste kann der Absender frei erfunden haben.
 */

/** Entfernt Klammern, Portangaben und die IPv4-in-IPv6-Schreibweise. */
function bereinige(eintrag: string): string {
  let ip = eintrag.trim().toLowerCase();
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined);
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  // „1.2.3.4:5678“ – bei IPv6 gehören die Doppelpunkte zur Adresse
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  return ip;
}

function ipv4(ip: string): number[] | null {
  const teile = ip.split('.');
  if (teile.length !== 4) return null;
  const zahlen = teile.map((t) => (/^\d{1,3}$/.test(t) ? Number(t) : NaN));
  return zahlen.every((z) => z >= 0 && z <= 255) ? zahlen : null;
}

const istIpv6 = (ip: string) => ip.includes(':') && /^[0-9a-f:]+$/.test(ip);

/** Ist das überhaupt eine IP-Adresse? */
export function istIp(eintrag: string): boolean {
  const ip = bereinige(eintrag);
  return ipv4(ip) !== null || istIpv6(ip);
}

/**
 * Adressen, die es nur in privaten Netzen gibt: Heimnetz, Docker, dieselbe Maschine, VPN.
 * Aus dem Internet kann keine Anfrage mit so einer Absenderadresse ankommen.
 */
export function istPrivat(eintrag: string): boolean {
  const ip = bereinige(eintrag);
  const v4 = ipv4(ip);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // 100.64.0.0/10: Netze von Anbietern und VPNs wie Tailscale
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (!istIpv6(ip)) return false;
  return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

/**
 * Die Adresse, der eine Anfrage zugerechnet wird (für Sperren nach Fehlversuchen).
 *
 * - Ohne vorgeschalteten Proxy zählt allein der letzte Eintrag – den hat der eigene Webserver
 *   geschrieben, er lässt sich nicht fälschen.
 * - Hinter einem Reverse Proxy zählt die letzte öffentliche Adresse der Kette: Die hat der Proxy
 *   eingetragen. Kommt alles aus dem privaten Netz, ist es der Eintrag vor dem Proxy.
 *
 * @param weitergeleitet Inhalt von X-Forwarded-For
 * @param verbindung     Gegenstelle der Verbindung, falls kein Webserver davor sitzt
 */
export function clientAdresse(weitergeleitet: string | undefined, verbindung: string | undefined, hinterProxy: boolean): string {
  const kette = (weitergeleitet ?? '')
    .split(',')
    .map(bereinige)
    .filter((e) => e && istIp(e));
  const letzter = kette.at(-1);
  if (!letzter) return verbindung ? bereinige(verbindung) : 'unbekannt';
  if (!hinterProxy) return letzter;

  for (let i = kette.length - 1; i >= 0; i--) {
    const eintrag = kette[i] as string;
    if (!istPrivat(eintrag)) return eintrag;
  }
  return kette.at(-2) ?? letzter;
}

/**
 * Macht aus einer Eingabe wie „https://Truhe.Example.de/“ den Rechnernamen „truhe.example.de“.
 * Liefert null, wenn kein gültiger Name übrig bleibt (auch bei IP-Adressen und Portangaben).
 */
export function leseRechnername(eingabe: string): string | null {
  let name = eingabe.trim().toLowerCase();
  name = name.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  name = name.replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (name.length === 0 || name.length > 253) return null;
  if (istIp(name)) return null;
  const marken = name.split('.');
  // Mindestens „name.endung“ – ein einzelnes Wort wie „truhe“ löst außerhalb des Heimnetzes niemand auf.
  if (marken.length < 2) return null;
  const gueltig = marken.every((m) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(m));
  return gueltig ? name : null;
}
