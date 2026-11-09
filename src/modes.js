// Modes de jeu : chaque mode dit quels Pokémon peuvent être tirés (dispo)
// et fabrique la liste ordonnée des indices que l'adversaire dévoile un par un.

const TYPES = ['Normal', 'Feu', 'Eau', 'Plante', 'Électrik', 'Glace', 'Combat', 'Poison', 'Sol', 'Vol', 'Psy', 'Insecte', 'Roche', 'Spectre', 'Dragon', 'Ténèbres', 'Acier', 'Fée'];
// attaquant -> [super efficace], [peu efficace], [sans effet]
const CHART = {
  Normal: [[], ['Roche', 'Acier'], ['Spectre']],
  Feu: [['Plante', 'Glace', 'Insecte', 'Acier'], ['Feu', 'Eau', 'Roche', 'Dragon'], []],
  Eau: [['Feu', 'Sol', 'Roche'], ['Eau', 'Plante', 'Dragon'], []],
  Plante: [['Eau', 'Sol', 'Roche'], ['Feu', 'Plante', 'Poison', 'Vol', 'Insecte', 'Dragon', 'Acier'], []],
  'Électrik': [['Eau', 'Vol'], ['Plante', 'Électrik', 'Dragon'], ['Sol']],
  Glace: [['Plante', 'Sol', 'Vol', 'Dragon'], ['Feu', 'Eau', 'Glace', 'Acier'], []],
  Combat: [['Normal', 'Glace', 'Roche', 'Ténèbres', 'Acier'], ['Poison', 'Vol', 'Psy', 'Insecte', 'Fée'], ['Spectre']],
  Poison: [['Plante', 'Fée'], ['Poison', 'Sol', 'Roche', 'Spectre'], ['Acier']],
  Sol: [['Feu', 'Électrik', 'Poison', 'Roche', 'Acier'], ['Plante', 'Insecte'], ['Vol']],
  Vol: [['Plante', 'Combat', 'Insecte'], ['Électrik', 'Roche', 'Acier'], []],
  Psy: [['Combat', 'Poison'], ['Psy', 'Acier'], ['Ténèbres']],
  Insecte: [['Plante', 'Psy', 'Ténèbres'], ['Feu', 'Combat', 'Poison', 'Vol', 'Spectre', 'Acier', 'Fée'], []],
  Roche: [['Feu', 'Glace', 'Vol', 'Insecte'], ['Combat', 'Sol', 'Acier'], []],
  Spectre: [['Psy', 'Spectre'], ['Ténèbres'], ['Normal']],
  Dragon: [['Dragon'], ['Acier'], ['Fée']],
  'Ténèbres': [['Psy', 'Spectre'], ['Combat', 'Ténèbres', 'Fée'], []],
  Acier: [['Glace', 'Roche', 'Fée'], ['Feu', 'Eau', 'Électrik', 'Acier'], []],
  'Fée': [['Combat', 'Dragon', 'Ténèbres'], ['Feu', 'Poison', 'Acier'], []],
};

function multiplier(att, defTypes) {
  let m = 1;
  const [se, nve, imm] = CHART[att];
  for (const d of defTypes) {
    if (se.includes(d)) m *= 2;
    else if (nve.includes(d)) m *= 0.5;
    else if (imm.includes(d)) m *= 0;
  }
  return m;
}

function matchups(types) {
  const out = { faible: [], resiste: [], immunise: [] };
  for (const att of TYPES) {
    const m = multiplier(att, types);
    if (m > 1) out.faible.push(m === 4 ? att + ' ×4' : att);
    else if (m === 0) out.immunise.push(att);
    else if (m < 1) out.resiste.push(m === 0.25 ? att + ' ×¼' : att);
  }
  return out;
}

const num = (x) => String(x).replace('.', ',');
const pad = (n) => String(n).padStart(4, '0');

// ctx : { media(url) -> url opaque, especeNom(id) -> nom FR }
const MODES = [
  {
    id: 'shiny', regle: 'Ton adversaire te montre les couleurs de la version shiny (chromatique) de chaque Pokémon, en bandes proportionnelles à leur place sur le sprite. Les shiny ont souvent des couleurs très différentes de la normale : il faut les connaître !', no: 1, nom: 'Couleurs du shiny', desc: 'Les couleurs de sa version shiny, en bandes proportionnelles.',
    dispo: (p) => !!p.palette,
    indices: (p) => [{ type: 'palette', titre: 'Couleurs du shiny', valeur: p.palette }],
  },
  {
    id: 'cri', regle: "Tu écoutes le cri de chaque Pokémon, comme dans les jeux. À toi de le reconnaître à l'oreille.", no: 2, nom: 'Cri', desc: 'Le cri du Pokémon, à écouter.',
    dispo: () => true,
    indices: (p, ctx) => [{ type: 'audio', titre: 'Cri', valeur: ctx.media(`https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${p.id}.ogg`) }],
  },
  {
    id: 'pokedex', regle: 'Tu lis la description du Pokédex de chaque Pokémon. Son nom est remplacé par « ??? ».', no: 3, nom: 'Description Pokédex', desc: 'Son entrée du Pokédex, nom masqué.',
    dispo: (p) => !!p.pokedex,
    indices: (p) => [{ type: 'texte', titre: p.pokedexLangue === 'en' ? 'Pokédex (en anglais)' : 'Pokédex', valeur: p.pokedex }],
  },
  {
    id: 'categorie', regle: "Dans le Pokédex, chaque Pokémon a une catégorie : Bulbizarre est le « Pokémon Graine », Pikachu le « Pokémon Souris »… Tu n'as que ça pour deviner.", no: 4, nom: "Catégorie d'espèce", desc: '« Pokémon Graine », « Pokémon Flamme »…',
    dispo: (p) => !!p.categorie,
    indices: (p) => [{ type: 'grand', titre: "Catégorie d'espèce", valeur: p.categorie }],
  },
  {
    id: 'gabarit', regle: "D'abord sa taille, puis son poids. Un Pokémon de 14 m ou de 0,1 kg, ça ne passe pas inaperçu !", no: 5, nom: 'Taille et poids', desc: 'Sa taille, puis son poids.',
    dispo: () => true,
    indices: (p) => [
      { type: 'grand', titre: 'Taille', valeur: num(p.taille) + ' m' },
      { type: 'grand', titre: 'Poids', valeur: num(p.poids) + ' kg' },
    ],
  },
  {
    id: 'attaques', regle: "Les 4 dernières attaques qu'il apprend en montant de niveau, dévoilées une par une. La plus tardive arrive en dernier : c'est souvent la plus parlante.", no: 6, nom: 'Dernières attaques', desc: 'Ses 4 dernières attaques apprises par niveau, la plus tardive en dernier.',
    dispo: (p) => p.attaques && p.attaques.length >= 2,
    indices: (p) => p.attaques.slice().reverse().map((a) => ({ type: 'grand', titre: `Attaque · niv. ${a.niveau}`, valeur: a.nom })),
  },
  {
    id: 'talents', regle: "Ses talents, ces capacités passives qu'il a en combat (Engrais, Intimidation…). Le talent caché est dévoilé en dernier.", no: 7, nom: 'Talents', desc: 'Ses talents, le talent caché en dernier.',
    dispo: (p) => p.talents && p.talents.length > 0,
    indices: (p) => p.talents.map((t) => ({ type: 'grand', titre: t.cache ? 'Talent caché' : 'Talent', valeur: t.nom })),
  },
  {
    id: 'types-inverses', regle: "Tu ne vois pas ses types, seulement ce qui lui fait très mal (ses faiblesses), puis ce qui lui fait peu ou pas d'effet (résistances et immunités). À toi de retrouver ses types.", no: 8, nom: 'Types inversés', desc: 'Pas ses types : seulement ses faiblesses, puis ses résistances et immunités.',
    dispo: (p) => p.types && p.types.length > 0,
    indices: (p) => {
      const m = matchups(p.types);
      const res = m.resiste.concat(m.immunise.map((t) => t + ' ×0'));
      return [
        { type: 'tags', titre: 'Faiblesses', valeur: m.faible.length ? m.faible : ['Aucune'] },
        { type: 'tags', titre: 'Résistances et immunités', valeur: res.length ? res : ['Aucune'] },
      ];
    },
  },
  {
    id: 'numero', regle: "D'abord le nom du Pokémon qui le suit dans le Pokédex national, puis son propre numéro.", no: 9, nom: 'Numéro de Pokédex', desc: 'Le Pokémon qui le suit dans le Pokédex, puis son numéro.',
    dispo: (p) => p.cat === 'base',
    indices: (p, ctx) => {
      const suivant = ctx.especeNom(p.espece + 1);
      const out = [];
      if (suivant) out.push({ type: 'grand', titre: 'Le Pokémon suivant dans le Pokédex', valeur: suivant });
      out.push({ type: 'grand', titre: 'Numéro national', valeur: 'N° ' + pad(p.espece) });
      return out;
    },
  },
  {
    id: 'evolution', regle: "Ton adversaire te dit seulement comment le Pokémon évolue : la méthode (pierre, échange, bonheur…) et, si c'est par niveau, à quel niveau. S'il n'évolue pas, c'est tout ce que tu sauras.", no: 10, nom: "Méthode d'évolution", desc: 'Comment il évolue (et à quel niveau), ou s’il n’évolue pas.',
    dispo: () => true,
    indices: (p) => {
      const simple = (m) => {
        if (/bonheur/i.test(m)) return 'Bonheur';
        if (/affection/i.test(m)) return 'Affection';
        return m.split(',')[0].trim();
      };
      const methodes = [...new Set(p.evolueEn.flatMap((e) => e.methodes.map(simple)))];
      return [{ type: 'grand', titre: 'Comment il évolue', valeur: methodes.length ? methodes.join(' ou ') : 'Il n’évolue pas' }];
    },
  },
  {
    id: 'oeufs', regle: "Ses groupes d'œufs, ceux qui décident avec qui il peut se reproduire à la pension (Monstrueux, Aquatique 1, Féerique…).", no: 11, nom: "Groupes d'œufs", desc: 'Ses groupes d’œufs.',
    dispo: (p) => p.oeufs && p.oeufs.length > 0,
    indices: (p) => [{ type: 'tags', titre: "Groupes d'œufs", valeur: p.oeufs }],
  },
  {
    id: 'generation', regle: 'Sa génération, puis le jeu dans lequel il est apparu pour la première fois.', no: 12, nom: 'Génération et jeu', desc: 'Sa génération, puis le jeu où il est apparu.',
    dispo: () => true,
    indices: (p) => [
      { type: 'grand', titre: 'Génération', valeur: p.genNom },
      { type: 'grand', titre: 'Premier jeu', valeur: p.jeu || '?' },
    ],
  },
  {
    id: 'stats', regle: 'Le total de ses stats de base, puis le détail en graphique (PV, Attaque, Défense, Attaque Spé., Défense Spé., Vitesse).', no: 13, nom: 'Stats de base', desc: 'Le total, puis le graphique des stats.',
    dispo: (p) => !!p.stats,
    indices: (p) => {
      const s = p.stats;
      return [
        { type: 'grand', titre: 'Total des stats', valeur: String(s.pv + s.atk + s.def + s.spa + s.spd + s.spe) },
        { type: 'stats', titre: 'Stats de base', valeur: s },
      ];
    },
  },
  {
    id: 'lieux', regle: "Le lieu le plus emblématique où on le trouve (parfois deux), dans le premier jeu où on peut l'attraper, puis le nom de ce jeu.", no: 14, nom: "Lieux d'apparition", desc: 'Son lieu le plus emblématique (un ou deux), puis le jeu.',
    dispo: (p) => !!p.lieux && p.lieux.lieux.length > 0,
    indices: (p) => p.lieux.lieux.map((l) => ({ type: 'grand', titre: 'Lieu', valeur: l }))
      .concat([{ type: 'grand', titre: 'Dans le jeu', valeur: p.lieux.jeu.includes(' / ') ? p.lieux.jeu.split(' / ').join(' et ') : p.lieux.jeu }]),
  },
  {
    id: 'zoom', regle: "Une seule image : un très gros plan sur une partie de son illustration officielle. Pas de dézoom, à toi de reconnaître le morceau.", no: 16, nom: 'Zoom', desc: 'Une seule image, un très gros plan sur une partie du corps.',
    dispo: () => true,
    indices: (p, ctx) => {
      const src = ctx.media(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`);
      // Un seul plan, très serré, pris dans le centre de l'illustration (là où se trouve presque toujours le Pokémon).
      const fx = 35 + Math.round(Math.random() * 30), fy = 32 + Math.round(Math.random() * 34);
      return [{ type: 'zoom', titre: 'Gros plan ×5', valeur: { src, zoom: 5, x: fx, y: fy } }];
    },
  },
  {
    id: 'libre', regle: "Pas d'indice automatique : ton adversaire écrit lui-même ses indices, à sa façon (une caractéristique, une devinette…).", no: 20, nom: 'Caractéristique libre', desc: 'Ton adversaire écrit lui-même ses indices.',
    dispo: () => true,
    indices: () => [],
    libre: true,
  },
];

const BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

module.exports = { MODES, BY_ID, matchups };
