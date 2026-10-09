/**
 * Erzeugt alle App-Icons aus public/logo.svg:  npm run icons
 *
 * Die Ergebnisse liegen in public/ und sind eingecheckt. Der Generator wird
 * dafür nur bei Bedarf per npx geholt und ist keine Abhängigkeit des Projekts –
 * deshalb kommt diese Datei ohne Importe aus.
 */
const HINTERGRUND = '#0a67a8';

export default {
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']] },
    // Maskable: Motiv in der sicheren Mitte, Fläche randlos in der Logofarbe
    maskable: { sizes: [512], padding: 0.12, resizeOptions: { background: HINTERGRUND } },
    // iOS rundet die Ecken selbst ab – daher randlos und ohne Transparenz
    apple: { sizes: [180], padding: 0, resizeOptions: { background: HINTERGRUND } },
  },
  images: ['public/logo.svg'],
};
