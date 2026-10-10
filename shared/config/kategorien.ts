/**
 * Kategorien und Standardhaltbarkeiten – hier nach Belieben anpassen.
 *
 * KATEGORIEN:   Auswahl in der App. `haltbarMonate` ist die Haltbarkeit, die
 *               vorgeschlagen wird, wenn kein Stichwort passt.
 * STICHWOERTER: Feinere Vorschläge anhand des Artikelnamens. Ein Stichwort
 *               passt, wenn ein Wort des Namens damit beginnt oder endet
 *               („Rinderhackfleisch“ endet auf „hackfleisch“). Endungen wie
 *               -e, -n, -en, -s werden ignoriert, Groß-/Kleinschreibung und
 *               Umlaute ebenfalls – der Wortstamm „erdbeer“ trifft also
 *               Erdbeere, Erdbeeren und Erdbeermarmelade. Passen mehrere,
 *               gewinnt das Wortende vor dem Wortanfang („Erbsensuppe“ ist
 *               eine Suppe), danach das längere Stichwort.
 *
 * Die `id` einer Kategorie nicht mehr ändern, sobald Artikel damit gespeichert sind.
 */

export interface Kategorie {
  id: string;
  name: string;
  emoji: string;
  haltbarMonate: number;
}

export interface Stichwort {
  woerter: string[];
  kategorie: string;
  /** Optional: weicht vom Emoji der Kategorie ab */
  emoji?: string;
  /** Optional: weicht von der Haltbarkeit der Kategorie ab */
  haltbarMonate?: number;
}

export const KATEGORIEN: Kategorie[] = [
  { id: 'fleisch', name: 'Fleisch', emoji: '🥩', haltbarMonate: 9 },
  { id: 'fisch', name: 'Fisch', emoji: '🐟', haltbarMonate: 6 },
  { id: 'gemuese', name: 'Gemüse', emoji: '🥦', haltbarMonate: 12 },
  { id: 'obst', name: 'Obst', emoji: '🍓', haltbarMonate: 12 },
  { id: 'brot', name: 'Brot/Backwaren', emoji: '🍞', haltbarMonate: 3 },
  { id: 'fertig', name: 'Fertiggerichte', emoji: '🍲', haltbarMonate: 3 },
  { id: 'eis', name: 'Eis/Desserts', emoji: '🍦', haltbarMonate: 6 },
  { id: 'kraeuter', name: 'Kräuter', emoji: '🌿', haltbarMonate: 8 },
  { id: 'sonstiges', name: 'Sonstiges', emoji: '📦', haltbarMonate: 6 },
];

/** Wird verwendet, wenn nichts passt oder eine Kategorie-ID unbekannt ist. */
export const STANDARD_KATEGORIE = 'sonstiges';

export const STICHWOERTER: Stichwort[] = [
  // Fleisch
  { woerter: ['hack', 'hackfleisch', 'gehacktes', 'mett', 'faschiertes', 'frikadelle', 'bulette', 'cevapcici'], kategorie: 'fleisch', haltbarMonate: 3 },
  { woerter: ['wurst', 'würstchen', 'bratwurst', 'wiener', 'leberkäse', 'aufschnitt', 'salami'], kategorie: 'fleisch', emoji: '🌭', haltbarMonate: 3 },
  { woerter: ['speck', 'bacon', 'schinken'], kategorie: 'fleisch', emoji: '🥓', haltbarMonate: 3 },
  { woerter: ['hähnchen', 'hühnchen', 'huhn', 'pute', 'truthahn', 'geflügel', 'ente', 'gans', 'chicken'], kategorie: 'fleisch', emoji: '🍗', haltbarMonate: 9 },
  { woerter: ['rind', 'rinder', 'steak', 'gulasch', 'roulade', 'braten', 'tafelspitz', 'kalb'], kategorie: 'fleisch', haltbarMonate: 12 },
  { woerter: ['schwein', 'schweine', 'schnitzel', 'kotelett', 'kasseler', 'rippchen', 'spareribs', 'geschnetzeltes'], kategorie: 'fleisch', haltbarMonate: 6 },
  { woerter: ['lamm', 'wild', 'reh', 'hirsch', 'wildschwein', 'kaninchen'], kategorie: 'fleisch', haltbarMonate: 9 },

  // Fisch
  { woerter: ['lachs', 'makrele', 'hering', 'aal'], kategorie: 'fisch', haltbarMonate: 3 },
  { woerter: ['fisch', 'forelle', 'kabeljau', 'seelachs', 'zander', 'dorade', 'thunfisch', 'fischstäbchen', 'schlemmerfilet'], kategorie: 'fisch' },
  { woerter: ['garnele', 'shrimp', 'scampi', 'krabbe', 'muschel', 'meeresfrüchte'], kategorie: 'fisch', emoji: '🍤' },
  { woerter: ['tintenfisch', 'calamari'], kategorie: 'fisch', emoji: '🦑' },

  // Gemüse
  { woerter: ['gemüse', 'brokkoli', 'broccoli', 'blumenkohl', 'rosenkohl', 'rotkohl', 'grünkohl', 'wirsing', 'suppengrün', 'zucchini', 'lauch', 'sellerie'], kategorie: 'gemuese' },
  { woerter: ['erbse', 'bohne', 'edamame'], kategorie: 'gemuese', emoji: '🫛' },
  { woerter: ['spinat', 'mangold'], kategorie: 'gemuese', emoji: '🥬' },
  { woerter: ['karotte', 'möhre'], kategorie: 'gemuese', emoji: '🥕' },
  { woerter: ['mais'], kategorie: 'gemuese', emoji: '🌽' },
  { woerter: ['paprika'], kategorie: 'gemuese', emoji: '🫑' },
  { woerter: ['pilz', 'champignon', 'pfifferling', 'steinpilz'], kategorie: 'gemuese', emoji: '🍄' },
  { woerter: ['tomate'], kategorie: 'gemuese', emoji: '🍅' },
  { woerter: ['kürbis'], kategorie: 'gemuese', emoji: '🎃' },
  { woerter: ['zwiebel'], kategorie: 'gemuese', emoji: '🧅' },

  // Obst
  { woerter: ['obst', 'beere', 'himbeer', 'brombeer', 'johannisbeer', 'stachelbeer', 'rhabarber', 'pflaume', 'zwetschge', 'aprikose', 'pfirsich'], kategorie: 'obst' },
  { woerter: ['erdbeer'], kategorie: 'obst', emoji: '🍓' },
  { woerter: ['heidelbeer', 'blaubeer'], kategorie: 'obst', emoji: '🫐' },
  { woerter: ['kirsch'], kategorie: 'obst', emoji: '🍒' },
  { woerter: ['mango'], kategorie: 'obst', emoji: '🥭' },
  { woerter: ['banane'], kategorie: 'obst', emoji: '🍌' },
  { woerter: ['apfel', 'apfelmus'], kategorie: 'obst', emoji: '🍎' },
  { woerter: ['ananas'], kategorie: 'obst', emoji: '🍍' },

  // Brot/Backwaren
  { woerter: ['brot', 'toast', 'stuten', 'hefezopf'], kategorie: 'brot' },
  { woerter: ['brötchen', 'semmel', 'baguette', 'ciabatta', 'schrippe', 'weckle'], kategorie: 'brot', emoji: '🥖' },
  { woerter: ['croissant', 'hörnchen'], kategorie: 'brot', emoji: '🥐' },
  { woerter: ['brezel', 'breze', 'laugenstange'], kategorie: 'brot', emoji: '🥨' },
  { woerter: ['kuchen', 'torte', 'muffin', 'strudel', 'gebäck', 'plätzchen'], kategorie: 'brot', emoji: '🍰', haltbarMonate: 4 },
  { woerter: ['waffel'], kategorie: 'brot', emoji: '🧇' },
  { woerter: ['pfannkuchen', 'pancake', 'crêpe'], kategorie: 'brot', emoji: '🥞' },
  { woerter: ['teig', 'blätterteig', 'pizzateig', 'hefeteig'], kategorie: 'brot', emoji: '🥟', haltbarMonate: 6 },
  { woerter: ['tortilla', 'wrap', 'fladenbrot', 'naan'], kategorie: 'brot', emoji: '🫓' },

  // Fertiggerichte
  { woerter: ['pizza', 'flammkuchen'], kategorie: 'fertig', emoji: '🍕', haltbarMonate: 6 },
  { woerter: ['suppe', 'eintopf', 'brühe', 'fond', 'chili', 'ragout'], kategorie: 'fertig', haltbarMonate: 4 },
  { woerter: ['lasagne', 'auflauf', 'gratin', 'bolognese', 'soße', 'sauce', 'reste', 'essen'], kategorie: 'fertig' },
  { woerter: ['curry', 'dal'], kategorie: 'fertig', emoji: '🍛' },
  { woerter: ['nudel', 'pasta', 'spätzle', 'gnocchi', 'tortellini'], kategorie: 'fertig', emoji: '🍝' },
  { woerter: ['reis', 'risotto'], kategorie: 'fertig', emoji: '🍚' },
  { woerter: ['knödel', 'kloß', 'klöße', 'maultasche', 'frühlingsrolle', 'gyoza', 'dumpling'], kategorie: 'fertig', emoji: '🥟' },
  { woerter: ['pommes', 'krokette', 'rösti', 'kartoffelpuffer', 'wedges'], kategorie: 'fertig', emoji: '🍟', haltbarMonate: 12 },
  { woerter: ['burger', 'nugget'], kategorie: 'fertig', emoji: '🍔', haltbarMonate: 6 },

  // Eis/Desserts
  // „beereis“ und „wassereis“ stehen hier, weil sie sonst als …reis (Fertiggericht) gelten würden.
  { woerter: ['eis', 'eiscreme', 'sorbet', 'speiseeis', 'beereis', 'wassereis'], kategorie: 'eis' },
  { woerter: ['eiswürfel'], kategorie: 'eis', emoji: '🧊', haltbarMonate: 12 },
  { woerter: ['dessert', 'tiramisu', 'pudding', 'mousse'], kategorie: 'eis', emoji: '🍮', haltbarMonate: 3 },

  // Kräuter
  { woerter: ['kräuter', 'petersilie', 'schnittlauch', 'dill', 'basilikum', 'koriander', 'bärlauch', 'minze', 'thymian', 'rosmarin', 'pesto'], kategorie: 'kraeuter' },
  { woerter: ['ingwer', 'knoblauch', 'chilischote', 'peperoni'], kategorie: 'kraeuter', emoji: '🫚' },

  // Sonstiges
  { woerter: ['butter'], kategorie: 'sonstiges', emoji: '🧈', haltbarMonate: 8 },
  { woerter: ['käse', 'mozzarella', 'parmesan'], kategorie: 'sonstiges', emoji: '🧀', haltbarMonate: 4 },
  { woerter: ['milch', 'sahne'], kategorie: 'sonstiges', emoji: '🥛', haltbarMonate: 3 },
];

const NACH_ID = new Map(KATEGORIEN.map((k) => [k.id, k]));

/** Liefert die Kategorie – bei unbekannter ID die Standardkategorie. */
export function kategorieInfo(id: string): Kategorie {
  return NACH_ID.get(id) ?? (NACH_ID.get(STANDARD_KATEGORIE) as Kategorie);
}
