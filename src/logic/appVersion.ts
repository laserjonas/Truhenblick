/**
 * Findet in der Startseite die Adresse des Hauptskripts der App.
 * Sie trägt einen Hash im Namen und ändert sich mit jeder gebauten Version –
 * daran lässt sich erkennen, ob auf dem Server eine neuere App liegt als die geladene.
 */
export function hauptskript(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) return src;
  }
  return null;
}

/** Ist die Version auf dem Server eine andere als die geladene? null = nicht feststellbar. */
export function istNeuereVersion(geladen: string | null | undefined, startseite: string): boolean | null {
  const aktuell = hauptskript(startseite);
  if (!geladen || !aktuell) return null;
  return aktuell !== geladen;
}
