// Logique de partie : salons, tirages, tours, indices. Aucune dépendance réseau ici.
const crypto = require('crypto');
const { MODES, BY_ID } = require('./modes');

const ROUNDS = 6;
const CHOIX = 3;
const SPRITE = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const SHINY = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${id}.png`;

const EV_NOMS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

// Texte d'import Showdown pour un Pokémon et un set Smogon (ou juste le nom s'il n'a pas de set).
function showdownText(p, set, nom) {
  let espece = (set && set.set.espece) || nom || p.showdown;
  if (p.cat === 'mega') espece = espece.replace(/-(Mega(-[XYZ])?|Primal)$/, '');
  if (!set) return espece;
  const s = set.set;
  const l = [espece + (s.item ? ' @ ' + s.item : '')];
  if (s.ability) l.push('Ability: ' + s.ability);
  if (s.level) l.push('Level: ' + s.level);
  if (s.tera) l.push('Tera Type: ' + s.tera);
  const fmt = (o) => Object.keys(EV_NOMS).filter((k) => o[k] != null).map((k) => o[k] + ' ' + EV_NOMS[k]).join(' / ');
  if (s.evs) l.push('EVs: ' + fmt(s.evs));
  if (s.nature) l.push(s.nature + ' Nature');
  if (s.ivs) l.push('IVs: ' + fmt(s.ivs));
  for (const m of s.moves || []) l.push('- ' + m);
  return l.join('\n');
}

class Data {
  constructor(list, sets) {
    this.sets = (sets && sets.sets) || sets || {};
    this.noms = (sets && sets.noms) || {};
    this.list = list;
    this.byId = new Map(list.map((p) => [p.id, p]));
    this.especeNom = new Map();
    for (const p of list) if (p.cat === 'base') this.especeNom.set(p.espece, p.nom);
  }
  // Toutes les formes jouables liées à ce Pokémon : sa ligne d'évolution et leurs formes (hors Méga).
  famille(p) {
    return this.list.filter((q) => q.chaine === p.chaine && (q.cat !== 'mega' || q.id === p.id));
  }
}

const media = new Map(); // jeton -> url distante (évite de montrer l'id du Pokémon au devineur)
function mediaToken(url) {
  const t = crypto.randomBytes(9).toString('base64url');
  media.set(t, { url, at: Date.now() });
  return '/m/' + t;
}

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)];
  return s;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DEFAULT_SETTINGS = () => ({
  modes: Array(ROUNDS).fill('shiny'),
  aleatoire: MODES.filter((m) => !m.libre).map((m) => m.id),
  formes: true,
  megas: false,
  legendaires: true,
  gens: [1, 2, 3, 4, 5, 6, 7, 8, 9],
});

// Photo de profil = numéro d'un dresseur de public/img/dresseurs.png (même ordre que DRESSEURS dans public/app.js).
const NB_DRESSEURS = 90;
const statsValides = (s) => { const n = (v) => Math.max(0, Math.min(99999, Math.floor(Number(v)) || 0)); s = s || {}; const p = n(s.parties); return { parties: p, victoires: Math.min(p, n(s.victoires)) }; };
const avatarValide = (id) => { const n = Math.floor(Number(id)); return n >= 0 && n < NB_DRESSEURS ? n : crypto.randomInt(NB_DRESSEURS); };

class Room {
  constructor(code, data) {
    this.code = code;
    this.data = data;
    this.players = [];
    this.reglages = DEFAULT_SETTINGS();
    this.phase = 'salon';
    this.touched = Date.now();
    this.scores = [0, 0]; // victoires sur Showdown entre ces deux joueurs, partie après partie
    this.partie = 0;
    this.reset();
  }

  reset() {
    this.round = 0;
    this.tour = 0;
    this.modeRound = null;
    this.courant = null;
    this.utilises = new Set();
    this.gagnant = null; // résultat du combat Showdown de cette partie
    for (const pl of this.players) pl.equipe = [];
  }

  addPlayer(nom, avatar, stats) {
    if (this.players.length >= 2) return null;
    const token = crypto.randomBytes(12).toString('base64url');
    this.players.push({ token, nom: String(nom || 'Joueur').slice(0, 20), avatar: avatarValide(avatar), stats: statsValides(stats), connecte: true, equipe: [] });
    return token;
  }

  // Photo de profil : un dresseur des jeux.
  setAvatar(idx, id) {
    const pl = this.players[idx];
    if (!pl) return 'Joueur inconnu.';
    pl.avatar = avatarValide(id);
    return null;
  }

  // Carte dresseur : parties jouées et victoires, gardées par chaque joueur sur son appareil.
  setStats(idx, stats) {
    const pl = this.players[idx];
    if (!pl) return 'Joueur inconnu.';
    pl.stats = statsValides(stats);
    return null;
  }

  // Après le combat sur Showdown : qui a gagné ? (l'un ou l'autre peut le dire, et corriger)
  resultat(idx, gagnant) {
    if (this.phase !== 'fin') return 'Le résultat se donne après la partie.';
    if (!this.players[idx]) return 'Joueur inconnu.';
    const g = Number(gagnant);
    if (g !== 0 && g !== 1) return 'Résultat inconnu.';
    if (this.gagnant !== null) this.scores[this.gagnant]--;
    this.gagnant = g;
    this.scores[g]++;
    return null;
  }

  indexOf(token) {
    return this.players.findIndex((p) => p.token === token);
  }

  setReglages(idx, r) {
    if (idx !== 0 || this.phase !== 'salon' || !r) return 'Seul l’hôte peut changer les réglages, avant la partie.';
    const ok = (id) => id === 'aleatoire' || BY_ID[id];
    if (Array.isArray(r.modes) && r.modes.length === ROUNDS && r.modes.every(ok)) this.reglages.modes = r.modes.slice();
    if (Array.isArray(r.aleatoire)) {
      const a = r.aleatoire.filter((id) => BY_ID[id]);
      if (a.length) this.reglages.aleatoire = a;
    }
    for (const k of ['formes', 'megas', 'legendaires']) if (typeof r[k] === 'boolean') this.reglages[k] = r[k];
    if (Array.isArray(r.gens)) {
      const g = r.gens.map(Number).filter((n) => n >= 1 && n <= 9);
      if (g.length) this.reglages.gens = [...new Set(g)].sort();
    }
    return null;
  }

  pool(mode) {
    const r = this.reglages;
    return this.data.list.filter((p) =>
      r.gens.includes(p.gen) &&
      (p.cat === 'base' || (p.cat === 'forme' && r.formes) || (p.cat === 'mega' && r.megas)) &&
      (r.legendaires || !p.legendaire) &&
      !this.utilises.has(p.espece) &&
      mode.dispo(p));
  }

  lancer(idx) {
    if (idx !== 0) return 'Seul l’hôte peut lancer la partie.';
    if (this.players.length < 2) return 'Il faut deux joueurs pour lancer.';
    if (this.phase !== 'salon') return 'La partie a déjà commencé.';
    this.reset();
    this.phase = 'round';
    this.debutRound();
    return null;
  }

  debutRound() {
    const choix = this.reglages.modes[this.round];
    const id = choix === 'aleatoire' ? this.reglages.aleatoire[crypto.randomInt(this.reglages.aleatoire.length)] : choix;
    this.modeRound = BY_ID[id];
    this.tour = 0;
    this.debutTour();
  }

  debutTour() {
    const mode = this.modeRound;
    let pool = this.pool(mode);
    if (pool.length < CHOIX) { // filtres trop stricts : on relâche les doublons d'espèce
      pool = this.data.list.filter((p) => mode.dispo(p));
    }
    // une seule carte par espèce dans un tirage
    const seen = new Set();
    const tirage = [];
    for (const p of shuffle(pool.slice())) {
      if (seen.has(p.espece)) continue;
      seen.add(p.espece);
      tirage.push(p);
      if (tirage.length === CHOIX) break;
    }
    for (const p of tirage) this.utilises.add(p.espece);
    const ctx = { media: mediaToken, especeNom: (n) => this.data.especeNom.get(n) };
    const devineur = (this.round + this.tour) % 2;
    this.courant = {
      devineur,
      maitre: 1 - devineur,
      cartes: tirage.map((p) => ({ p, indices: mode.indices(p, ctx), reveles: 0 })),
      choix: null,
    };
    this.phase = 'round';
  }

  devoiler(idx, carte) {
    const c = this.courant;
    if (this.phase !== 'round' || !c || idx !== c.maitre) return 'Seul ton adversaire peut dévoiler les indices.';
    const k = c.cartes[carte];
    if (!k) return 'Carte inconnue.';
    if (k.reveles >= k.indices.length) return 'Tous les indices de cette carte sont déjà dévoilés.';
    k.reveles++;
    return null;
  }

  indiceLibre(idx, carte, texte) {
    const c = this.courant;
    if (this.phase !== 'round' || !c || idx !== c.maitre) return 'Seul ton adversaire peut écrire un indice.';
    const k = c.cartes[carte];
    const t = String(texte || '').trim().slice(0, 140);
    if (!k || !t) return 'Indice vide.';
    if (k.indices.length >= 8) return 'Maximum 8 indices par carte.';
    k.indices.push({ type: 'texte', titre: 'Indice de ton adversaire', valeur: t });
    k.reveles = k.indices.length;
    return null;
  }

  recruter(idx, carte) {
    const c = this.courant;
    if (this.phase !== 'round' || !c || idx !== c.devineur) return 'Ce n’est pas ton tour de recruter.';
    const k = c.cartes[carte];
    if (!k) return 'Carte inconnue.';
    c.choix = carte;
    c.devoilees = c.cartes.map(() => false);
    this.players[idx].equipe.push({ id: k.p.id, forme: k.p.id, set: 0 });
    this.phase = 'revelation';
    return null;
  }

  revelerCarte(idx, carte) {
    const c = this.courant;
    if (this.phase !== 'revelation' || !c || idx !== c.maitre) return 'Seul ton adversaire peut révéler les Pokémon.';
    if (!c.cartes[carte]) return 'Carte inconnue.';
    c.devoilees[carte] = true;
    return null;
  }

  continuer() {
    if (this.phase !== 'revelation') return 'Rien à continuer.';
    if (this.courant && this.courant.devoilees.some((d) => !d)) return 'Ton adversaire doit d’abord révéler les trois Pokémon.';
    if (this.tour === 0) {
      this.tour = 1;
      this.debutTour();
    } else if (this.round < ROUNDS - 1) {
      this.round++;
      this.debutRound();
    } else {
      this.phase = 'fin';
      this.partie++;
      this.courant = null;
    }
    return null;
  }

  choisirForme(idx, slot, id) {
    if (this.phase !== 'fin') return 'Les formes se choisissent en fin de partie.';
    const e = this.players[idx] && this.players[idx].equipe[slot];
    if (!e) return 'Emplacement inconnu.';
    const base = this.data.byId.get(e.id);
    if (!this.data.famille(base).some((q) => q.id === id)) return 'Forme non autorisée pour ce Pokémon.';
    e.forme = id;
    e.set = 0;
    return null;
  }

  choisirSet(idx, slot, n) {
    if (this.phase !== 'fin') return 'Les sets se choisissent en fin de partie.';
    const e = this.players[idx] && this.players[idx].equipe[slot];
    const sets = e && this.data.sets[e.forme];
    if (!sets || !sets[n]) return 'Set inconnu.';
    e.set = n;
    return null;
  }

  exportEquipe(pl) {
    return pl.equipe.map((e) => {
      const sets = this.data.sets[e.forme];
      return showdownText(this.data.byId.get(e.forme), sets ? sets[e.set] || sets[0] : null, this.data.noms[e.forme]);
    }).join('\n\n');
  }

  rejouer(idx) {
    if (idx !== 0) return 'Seul l’hôte peut relancer.';
    this.phase = 'salon';
    this.reset();
    return null;
  }

  // ---------- vue envoyée à un joueur : il ne reçoit que ce qu'il a le droit de voir ----------
  carteVisible(p) {
    return { id: p.id, nom: p.nom, types: p.types, sprite: SPRITE(p.id) };
  }

  view(idx) {
    const c = this.courant;
    const v = {
      code: this.code,
      moi: idx,
      phase: this.phase,
      hote: 0,
      rounds: ROUNDS,
      round: this.round,
      tour: this.tour,
      reglages: this.reglages,
      scores: this.scores,
      partie: this.partie,
      gagnant: this.gagnant,
      modes: MODES.map((m) => ({ id: m.id, no: m.no, nom: m.nom, desc: m.desc, regle: m.regle })),
      joueurs: this.players.map((pl, pi) => ({
        nom: pl.nom,
        avatar: pl.avatar,
        stats: pl.stats,
        connecte: pl.connecte,
        equipe: pl.equipe.map((e, n) => {
          // le dernier recruté reste secret tant que l'adversaire ne l'a pas révélé
          const secret = this.phase === 'revelation' && c && pi === c.devineur && n === pl.equipe.length - 1 && !c.devoilees[c.choix] && idx !== c.maitre;
          if (secret) return { id: 0, nom: '???', types: [], sprite: '' };
          // en fin de partie, on ne voit pas la forme ni le set choisis par l'adversaire
          return this.carteVisible(this.data.byId.get(pi === idx ? e.forme : e.id));
        }),
      })),
    };
    if (this.modeRound) v.mode = { id: this.modeRound.id, nom: this.modeRound.nom, desc: this.modeRound.desc, regle: this.modeRound.regle, libre: !!this.modeRound.libre };
    if (c) {
      v.devineur = c.devineur;
      v.maitre = c.maitre;
      v.choix = c.choix;
      v.cartes = c.cartes.map((k, ci) => {
        const toutVoir = idx === c.maitre || (this.phase === 'revelation' && c.devoilees[ci]);
        const base = { reveles: k.reveles, total: k.indices.length, devoilee: this.phase === 'revelation' ? c.devoilees[ci] : undefined };
        if (toutVoir) {
          const vis = this.carteVisible(k.p);
          if (this.modeRound && this.modeRound.id === 'shiny') { vis.sprite = SHINY(k.p.id); vis.shiny = true; }
          return Object.assign(base, vis, {
            indices: k.indices.map((h, i) => Object.assign({ visible: i < k.reveles }, h)),
          });
        }
        return Object.assign(base, { indices: k.indices.slice(0, k.reveles).map((h) => Object.assign({ visible: true }, h)) });
      });
    }
    if (this.phase === 'fin') {
      const me = this.players[idx];
      v.familles = me ? me.equipe.map((e) => this.data.famille(this.data.byId.get(e.id)).map((q) => ({ id: q.id, nom: q.nom, choisi: q.id === e.forme }))) : [];
      v.sets = me ? me.equipe.map((e) => (this.data.sets[e.forme] || []).map((s, n) => ({ n, label: s.label, choisi: n === e.set }))) : [];
      v.showdown = this.players.map((pl, pi) => (pi === idx ? this.exportEquipe(pl) : null));
    }
    return v;
  }
}

class Lobby {
  constructor(data) {
    this.data = data;
    this.rooms = new Map();
  }
  create() {
    let code;
    do code = randomCode(); while (this.rooms.has(code));
    const room = new Room(code, this.data);
    this.rooms.set(code, room);
    return room;
  }
  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim());
  }
  cleanup(maxAgeMs = 6 * 3600e3) {
    const now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.touched > maxAgeMs) this.rooms.delete(k);
    for (const [k, m] of media) if (now - m.at > maxAgeMs) media.delete(k);
  }
}

module.exports = { Data, Room, Lobby, media, ROUNDS, showdownText };
