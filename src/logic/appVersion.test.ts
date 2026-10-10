import { describe, expect, it } from 'vitest';
import { hauptskript, istNeuereVersion } from './appVersion.ts';

const SEITE = (skript: string) => `<!doctype html>
<html lang="de">
  <head>
    <script>window.x = 1</script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
    <script type="module" crossorigin src="${skript}"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('hauptskript', () => {
  it('findet das Modulskript des gebauten Stands', () => {
    expect(hauptskript(SEITE('/assets/index-NR1iJkZC.js'))).toBe('/assets/index-NR1iJkZC.js');
  });

  it('kommt mit anderer Reihenfolge der Attribute und dem Entwicklungsserver zurecht', () => {
    expect(hauptskript('<script src="/src/main.tsx" type="module"></script>')).toBe('/src/main.tsx');
    expect(hauptskript(`<script type='module' src='/a.js'></script>`)).toBe('/a.js');
  });

  it('überspringt andere Skripte', () => {
    expect(hauptskript('<script src="/registerSW.js"></script><script type="module" src="/app.js"></script>')).toBe('/app.js');
    expect(hauptskript('<p>kein Skript</p>')).toBeNull();
  });
});

describe('istNeuereVersion', () => {
  it('vergleicht geladenen und ausgelieferten Stand', () => {
    expect(istNeuereVersion('/assets/index-alt.js', SEITE('/assets/index-neu.js'))).toBe(true);
    expect(istNeuereVersion('/assets/index-alt.js', SEITE('/assets/index-alt.js'))).toBe(false);
  });

  it('legt sich nicht fest, wenn etwas fehlt', () => {
    expect(istNeuereVersion(null, SEITE('/assets/index-neu.js'))).toBeNull();
    expect(istNeuereVersion('/assets/index-alt.js', '<html></html>')).toBeNull();
  });
});
