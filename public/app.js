/* Starters à l'aveugle : client. Le serveur envoie l'état complet à chaque changement ; on redessine. */
(function () {
  const socket = io();
  const app = document.getElementById('app');
  const LETTRES = ['A', 'B', 'C', 'D'];
  const STAT_NOMS = { pv: 'PV', atk: 'Atq', def: 'Déf', spa: 'Atq Spé', spd: 'Déf Spé', spe: 'Vit' };
  const REACTIONS = ['Sûr de toi ? 😏', 'Bien joué 👏', 'Aïe… 😬', 'Trop facile 😎'];
  let etat = null;
  let brouillons = {}; // textes d'indices libres en cours de saisie
  const vus = new Set(); // éléments déjà affichés : seuls les nouveaux s'animent
  let premierRendu = true;
  let avatarOuvert = false; // sélecteur de photo de profil ouvert dans le salon
  const fresh = (k) => { if (vus.has(k)) return false; vus.add(k); return !premierRendu; };
  const calme = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  };

  // ---------- petits outils DOM ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function emit(ev, payload) {
    socket.emit(ev, payload || {}, (r) => { if (r && r.erreur) toast(r.erreur); });
  }
  function copier(texte, bouton) {
    const done = () => { const old = bouton.textContent; bouton.textContent = 'Copié !'; setTimeout(() => { bouton.textContent = old; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(texte).then(done, () => toast('Copie impossible, sélectionne le texte à la main.'));
    else toast('Copie impossible, sélectionne le texte à la main.');
  }

  // ---------- session ----------
  const params = new URLSearchParams(location.search);
  socket.on('connect', () => {
    const code = store.get('salon');
    const token = store.get('token');
    if (code && token && (!params.get('salon') || params.get('salon').toUpperCase() === code)) {
      socket.emit('rejoindre', { code, token }, (r) => { if (r && r.erreur) { store.set('token', ''); render(); } });
    }
  });
  socket.on('session', ({ code, token }) => {
    store.set('salon', code);
    store.set('token', token);
    try { history.replaceState(null, '', '?salon=' + code); } catch (e) { /* adresse non modifiable */ }
  });
  socket.on('etat', (s) => {
    const avant = etat ? etat.phase + etat.round + etat.tour : 'accueil';
    etat = s;
    const go = () => { render(); suiviStats(); };
    // Transition douce entre deux écrans (accueil → salon → manche → révélation → fin)
    if (document.startViewTransition && !calme && avant !== s.phase + s.round + s.tour) document.startViewTransition(go);
    else go();
  });
  socket.on('reaction', ({ de, texte }) => {
    if (!etat) return;
    document.querySelectorAll('.bulle').forEach((b) => b.remove());
    const nom = etat.joueurs[de] ? etat.joueurs[de].nom : '?';
    const b = h('div', { class: 'bulle', role: 'status' }, nom + ' : ' + texte);
    document.body.append(b);
    setTimeout(() => b.remove(), 4000);
  });

  // ---------- rendu ----------
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const scene = etat ? [etat.phase, etat.round, etat.tour].join('-') : 'accueil';
    const nouvelleScene = !vus.has('scene:' + scene);
    vus.add('scene:' + scene);
    app.replaceChildren();
    app.classList.remove('scene-in');
    if (nouvelleScene) { void app.offsetWidth; app.classList.add('scene-in'); }
    if (nouvelleScene && etat && etat.phase === 'round') annonce();
    document.querySelectorAll('.lower').forEach((e) => e.remove());
    document.body.dataset.phase = etat ? etat.phase : 'accueil';
    if (!etat) app.append(accueil());
    else if (etat.phase === 'salon') app.append(salon());
    else if (etat.phase === 'round') app.append(...round());
    else if (etat.phase === 'revelation') app.append(...revelation());
    else if (etat.phase === 'fin') app.append(...fin());
    if (etat && etat.phase !== 'salon') document.body.append(bandeau());
    if (focusId) { const f = document.getElementById(focusId); if (f) f.focus(); }
    premierRendu = false;
  }

  // ---------- effets ----------
  function annonce() {
    document.querySelectorAll('.annonce').forEach((e) => e.remove());
    const moiDevine = etat.moi === etat.devineur;
    const a = h('div', { class: 'annonce', 'aria-hidden': 'true' },
      h('div', { class: 'eyebrow' }, etat.mode.nom + ' · tour ' + (etat.tour + 1) + '/2'),
      h('b', {}, 'ROUND ' + (etat.round + 1)),
      h('span', {}, moiDevine ? 'À toi de deviner !' : 'Tu es le maître du jeu'));
    document.body.append(a);
    setTimeout(() => a.remove(), 2200);
  }

  function confettis(n) {
    if (calme) return;
    const c = h('canvas', { id: 'confettis' });
    document.body.append(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const couleurs = ['#ffcc33', '#f4f1ff', '#ff48a0', '#6aa8ff', '#5ef08a'];
    const ps = Array.from({ length: n }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .45,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * Math.PI,
      vr: (Math.random() - .5) * .3, w: 6 + Math.random() * 6, c: couleurs[Math.floor(Math.random() * couleurs.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); g.restore();
      }
      if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // Paillettes « shiny » qui flottent dans le décor.
  (function paillettes() {
    if (calme) return;
    const c = h('canvas', { id: 'paillettes', 'aria-hidden': 'true' });
    document.body.prepend(c);
    const g = c.getContext('2d');
    let W, H;
    const taille = () => { const d = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
    taille(); addEventListener('resize', taille);
    const ps = Array.from({ length: 34 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: 2 + Math.random() * 5, v: .15 + Math.random() * .4, p: Math.random() * 6.28, c: Math.random() < .5 ? '255,204,51' : Math.random() < .5 ? '244,241,255' : '255,120,200' }));
    function etoile(x, y, s, a, col) {
      g.fillStyle = 'rgba(' + col + ',' + a + ')';
      g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill();
    }
    (function frame(t) {
      g.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.y -= p.v; p.x += Math.sin(t / 2000 + p.p) * .2;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
        etoile(p.x, p.y, p.s, .25 + .35 * Math.abs(Math.sin(t / 700 + p.p)), p.c);
      }
      requestAnimationFrame(frame);
    })(0);
  })();

  // ---------- habillage : icônes, sprites, décor ----------
  const ICONES = {
    shiny: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
    cri: 'M4 10v4h4l5 4V6L8 10z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12',
    pokedex: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z M4 19V5 M8 7h7 M8 11h5',
    categorie: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
    gabarit: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
    attaques: 'M13 2L4 14h7l-1 8 9-12h-7z',
    talents: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.8l6.1-.9z',
    'types-inverses': 'M7 4L3 8l4 4 M3 8h14 M17 12l4 4-4 4 M21 16H7',
    numero: 'M5 9h14 M5 15h14 M10 4L8 20 M16 4l-2 16',
    evolution: 'M6 13l6-6 6 6 M6 19l6-6 6 6 M12 7V3',
    oeufs: 'M12 3c4 0 7 6.5 7 11a7 7 0 0 1-14 0c0-4.5 3-11 7-11z M8.5 13.5l2-1.5 2 1.5 2-1.5 1.5 1',
    generation: 'M6 3h12v14l-2 4H8l-2-4z M9 7h6v5H9z',
    stats: 'M5 20v-8 M11 20V5 M17 20v-5 M3 20h18',
    lieux: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M11 8v6 M8 11h6',
    libre: 'M4 5h16v11H9l-5 4z M8 9.5h8 M8 12.5h5',
    aleatoire: 'M4 4h16v16H4z M8.5 8.5h.01 M15.5 15.5h.01 M12 12h.01 M15.5 8.5h.01 M8.5 15.5h.01',
    oeil: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    ampoule: 'M9 18h6 M10 21.5h4 M12 2.5a6.5 6.5 0 0 0-3.8 11.8V16h7.6v-1.7A6.5 6.5 0 0 0 12 2.5z',
    pokeball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h6.5 M14.5 12H21 M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    combat: 'M14.5 17.5L3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2 M9.5 17.5L21 6V3h-3L6.5 14.5 M11 19l-6-6 M8 16l-4 4 M5 21l-2-2',
    lien: 'M9 9h11v11H9z M5 15H4V4h11v1',
    formes: 'M4 4h7v7H4z M17.5 13a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M17 3.5l4 7h-8z M7.5 14l3.5 6H4z',
    megas: 'M12 2l5 6.5L12 22 7 8.5z M7 8.5h10 M12 2v20',
    legendaires: 'M3 18h18 M3 18L4.5 7l4.5 4 3-6 3 6 4.5-4L21 18',
    joueur: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M4 21a8 8 0 0 1 16 0',
  };
  function ico(nom, cls) {
    const s = h('span', { class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICONES[nom] || ICONES.pokeball) + '"/></svg>';
    return s;
  }
  const COULEUR_MODE = {
    shiny: '#ffcc33', cri: '#b48cff', pokedex: '#ff6b6b', categorie: '#ffa94d', gabarit: '#4cd1a0', attaques: '#ff7a45',
    talents: '#6aa8ff', 'types-inverses': '#e36cff', numero: '#c9c3ef', evolution: '#5ef08a', oeufs: '#ffd6a5',
    generation: '#63d2ff', stats: '#ff7aa8', lieux: '#9bdc5a', zoom: '#4dd6e0', libre: '#f4f1ff', aleatoire: '#ffcc33',
  };
  const NOMS_MODES = [['shiny', 'Couleurs du shiny'], ['cri', 'Cri'], ['pokedex', 'Description Pokédex'], ['categorie', 'Catégorie'],
    ['gabarit', 'Taille et poids'], ['attaques', 'Dernières attaques'], ['talents', 'Talents'], ['types-inverses', 'Types inversés'],
    ['numero', 'Numéro de Pokédex'], ['evolution', "Méthode d'évolution"], ['oeufs', "Groupes d'œufs"], ['generation', 'Génération et jeu'],
    ['stats', 'Stats de base'], ['lieux', "Lieux d'apparition"], ['zoom', 'Zoom'], ['libre', 'Caractéristique libre']]
    .filter(([id]) => !(window.__sansCri && id === 'cri'));
  const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unys', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  const STARTERS = [[1, 4, 7], [152, 155, 158], [252, 255, 258], [387, 390, 393], [495, 498, 501], [650, 653, 656], [722, 725, 728], [810, 813, 816], [906, 909, 912]];
  // Sprites du décor : GitHub en ligne, atlas local dans la version test (window.__sprite, prêt un peu plus tard).
  const spriteSrc = (id) => window.__sprite ? window.__sprite(id) : window.__spritesAsync ? '' : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + id + '.png';
  const quandSprites = (fn) => { if (!window.__spritesAsync || window.__sprite) fn(); else addEventListener('sprites', fn, { once: true }); };
  const hasard = (n) => Math.floor(Math.random() * n);
  const pokeball = (cls) => h('span', { class: 'pb' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, h('i'));

  const planche = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

  // ---------- Pixel art : moteur minuscule (cartes de lettres -> canvas, contour automatique) ----------
  const PIX = (() => {
    const CONTOUR = '#0d1424';
    function carte(rows) { const w = Math.max(...rows.map((r) => r.length)); return { w, h: rows.length, px: rows.map((r) => r.padEnd(w, '.')) }; }
    function proc(w, hh, f) { const px = []; for (let j = 0; j < hh; j++) { let r = ''; for (let i = 0; i < w; i++) r += f(i, j) || '.'; px.push(r); } return { w, h: hh, px }; }
    // contour : 'o' dans la carte = trait intérieur ; les bords extérieurs sont tracés automatiquement
    function rendu(g, pal, contour = CONTOUR) {
      const c = document.createElement('canvas'); c.width = g.w + 2; c.height = g.h + 2;
      const x = c.getContext('2d');
      const plein = (i, j) => i >= 0 && j >= 0 && i < g.w && j < g.h && g.px[j][i] !== '.';
      for (let j = -1; j <= g.h; j++) for (let i = -1; i <= g.w; i++) {
        if (plein(i, j)) { const k = g.px[j][i]; x.fillStyle = k === 'o' ? contour : (pal[k] || '#ff00ff'); x.fillRect(i + 1, j + 1, 1, 1); }
        else if (contour && (plein(i - 1, j) || plein(i + 1, j) || plein(i, j - 1) || plein(i, j + 1))) { x.fillStyle = contour; x.fillRect(i + 1, j + 1, 1, 1); }
      }
      return c;
    }
    function miroir(src) { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const x = c.getContext('2d'); x.scale(-1, 1); x.drawImage(src, -src.width, 0); return c; }

    // Hautes herbes : une touffe à trois pointes, répétée en quinconce (le motif classique des routes).
    const TOUFFE = [
      '..h....h....h..',
      '..l...hl...hl..',
      '.ll...ll...ll..',
      '.lm..lmm..lmm..',
      'lmm..mmm.lmmd..',
      'lmmm.mmd.mmmd.',
      'mmmdmmmdmmmmdd.',
      'mmmddmmddmmddd.',
      'dmmddmmdddmddd.',
      'ddddddddddddd..',
    ];
    const herbePal = { h: '#9fe6bd', l: '#4aa97c', m: '#2a7b5c', d: '#195442' };
    // Une touffe d'herbes de n tuiles de large, fusionnée avant le contour ; 'agite' décale les pointes (bruissement).
    function tuileHerbe(n, agite) {
      const W = 16 * n, H = 16, t = carte(TOUFFE);
      const g = Array.from({ length: H }, () => Array(W).fill('.'));
      const pose = (ox, oy, dec) => { for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) { const k = t.px[j][i]; if (k === '.') continue; const x = ox + i + (j < 4 ? dec : 0), y = oy + j; if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = k; } };
      for (let k = 0; k < n * 2; k++) pose(k * 8, 0, agite ? (k % 2 ? 1 : -1) : 0);
      for (let k = -1; k < n * 2; k++) pose(k * 8 + 4, 6, agite ? (k % 2 ? -1 : 1) : 0);
      return { w: W, h: H, px: g.map((r) => r.join('')) };
    }

    // Arbre de route : couronne en étages arrondis, éclairée par la lune en haut à gauche.
    function arbre(hauteur) {
      const W = 22, H = hauteur, tronc = 4, cx = (W - 1) / 2;
      const etages = H > 28 ? [[.18, 5], [.42, 7.5], [.68, 10]] : [[.25, 6], [.6, 9.5]];
      return proc(W, H, (i, j) => {
        if (j >= H - tronc) return Math.abs(i - cx) < 2 ? (i < cx ? 't' : 'T') : null;
        const hc = H - tronc;
        for (let k = etages.length - 1; k >= 0; k--) {
          const [py, r] = etages[k]; const cy = py * hc; const ry = r * .85;
          const dx = (i - cx) / r, dy = (j - cy) / ry;
          if (dx * dx + dy * dy <= 1 && j <= cy + ry - (Math.abs(i - cx) % 3 === 0 ? 1 : 0)) {
            if (dy > .62 && k > 0) return (i % 2 ? 'd' : 'm');
            const lum = -dx * .6 - dy * .9;
            if (lum > .75) return 'h';
            if (lum > .15) return 'l';
            if (lum > -.55) return 'm';
            return (i + j) % 2 && lum > -.75 ? 'm' : 'd';
          }
        }
        return null;
      });
    }
    const arbrePal = { h: '#5f9f92', l: '#2f6b5e', m: '#1f4d47', d: '#14323a', t: '#3d2c2c', T: '#2a1d22' };

    // Petits éléments du décor
    const FLEUR = [['.r.', 'ryr', '.r.', '.g.'], ['r.r', '.y.', 'r.r', '.g.']];
    const BALLE = carte(['..rrrr..', '.rrrwrr.', 'rrrrrrrr', 'oooccooo', 'wwwccwww', '.wwwwww.', '..wwww..']);
    const PANNEAU = carte(['bbbbbbbbbbbbbb', 'blllllllllllllb', 'bl.oo.ooo.oo.lb', 'blllllllllllllb', 'bl.ooo.oo.ooolb', 'blllllllllllllb', 'bbbbbbbbbbbbbbb', '.....tT........', '.....tT........', '.....tT........', '.....tT........']);
    const BARRIERE = carte(['tT....tT....tT', 'llllllllllllll', 'tT....tT....tT', 'llllllllllllll', 'tT....tT....tT', 'tT....tT....tT']);
    const boisPal = { b: '#6b4a34', l: '#9c7350', t: '#8a6445', T: '#5a3d2c' };
    const fleurs = new Map(), miroirs = new Map();
    return {
      rendu, carte, miroir,
      fleurCache: (n, c) => { const k = n + c; if (!fleurs.has(k)) fleurs.set(k, rendu(carte(FLEUR[n]), { r: c, y: '#ffe066', g: '#2f8560' }, null)); return fleurs.get(k); },
      miroirCache: (k, src) => { if (!miroirs.has(k)) miroirs.set(k, miroir(src)); return miroirs.get(k); },
      herbe: (n, agite) => rendu(tuileHerbe(n || 1, agite), herbePal),
      arbre: (hh) => rendu(arbre(hh), arbrePal),
      fleur: (n, coul) => rendu(carte(FLEUR[n]), { r: coul, y: '#ffe066', g: '#2f8560' }, null),
      balle: () => rendu(BALLE, { r: '#e8344e', w: '#f4f1ff', c: '#f4f1ff' }),
      panneau: () => rendu(PANNEAU, Object.assign({ o: '#3a271d' }, boisPal)),
      barriere: () => rendu(BARRIERE, boisPal),
    };
  })();

  // ---------- La route : scène en pixel art au bas de l'écran ----------
  // Lisière d'arbres, hautes herbes, chemin, panneau et fleurs ; des Pokémon sauvages sortent la tête des herbes
  // et des dresseurs passent sur le chemin avec leur Pokémon. Coordonnées en « pixels du jeu », agrandis S fois.
  function route() {
    const H = 64, HAUT_HERBE = 34, BAS_HERBE = 50, SOL = 38, PIEDS = 61;
    const wrap = h('div', { class: 'route', 'aria-hidden': 'true' });
    const cv = h('canvas');
    wrap.append(cv);
    const g = cv.getContext('2d');
    const al = (a, b) => a + Math.random() * (b - a);
    let S = 3, W = 0, fond = null, touffes = [], fleurs = [], balle = null, scintille = 0;
    const herbes = new Map();
    const herbe = (n, agite) => { const k = n + (agite ? 'a' : ''); if (!herbes.has(k)) herbes.set(k, PIX.herbe(n, agite)); return herbes.get(k); };

    // Sprites Pokémon : chargés une fois, avec leur boîte utile (pour les faire sortir des herbes au bon niveau).
    const sprites = new Map();
    function sprite(id) {
      if (sprites.has(id)) return sprites.get(id);
      const pr = new Promise((ok) => {
        const src = spriteSrc(id);
        if (!src) { ok(null); return; }
        const img = new Image();
        if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => {
          let box = { x: 0, y: 0, w: img.width, h: img.height };
          try {
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            const d = x.getImageData(0, 0, c.width, c.height).data;
            let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
            for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) if (d[(j * c.width + i) * 4 + 3] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
            if (x1 >= 0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
          } catch (e) { /* image d'une autre origine : boîte entière */ }
          ok({ img, box, miroir: null });
        };
        img.onerror = () => ok(null);
        img.src = src;
      });
      sprites.set(id, pr);
      return pr;
    }
    // Un Pokémon dessiné au tiers de sa taille (les sprites font 96 px : 1 pixel du jeu = 1 pixel du sprite quand S = 3).
    function dessinePoke(p, x, yBas, versDroite) {
      const k = 1 / 3, b = p.box;
      const w = b.w * k, hh = b.h * k;
      g.save();
      if (versDroite) { g.translate(Math.round(x + w), 0); g.scale(-1, 1); x = 0; }
      g.drawImage(p.img, b.x, b.y, b.w, b.h, Math.round(x), Math.round(yBas - hh), w, hh);
      g.restore();
      return { w, h: hh };
    }

    function construit() {
      S = innerWidth >= 1100 ? 3 : 2;
      W = Math.ceil(innerWidth / S);
      cv.width = W * S; cv.height = H * S;
      cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
      fond = document.createElement('canvas'); fond.width = W; fond.height = H;
      const f = fond.getContext('2d');
      // collines lointaines
      for (const [coul, base, amp, per] of [['#16132f', 18, 6, 47], ['#1c1840', 26, 5, 29]]) {
        f.fillStyle = coul;
        const ph = al(0, 100);
        for (let x = 0; x < W; x++) { const y = Math.round(base + amp * Math.sin((x + ph) / per) + 2 * Math.sin((x + ph) / 11)); f.fillRect(x, y, 1, H - y); }
      }
      // lisière d'arbres
      const arbres = [PIX.arbre(32), PIX.arbre(26), PIX.arbre(30)];
      for (let x = -12; x < W;) {
        const n = 2 + Math.floor(al(0, 5));
        for (let k = 0; k < n && x < W; k++) { const a = arbres[Math.floor(Math.random() * arbres.length)]; f.drawImage(a, x, SOL + 4 - a.height + Math.round(al(0, 3))); x += Math.round(al(11, 16)); }
        x += Math.round(al(14, 46));
      }
      // sol herbeux avec texture
      f.fillStyle = '#163d33'; f.fillRect(0, SOL, W, H - SOL);
      for (let i = 0; i < W * 1.2; i++) { f.fillStyle = Math.random() < .5 ? '#1d4b3e' : '#11302a'; f.fillRect(Math.floor(al(0, W)), Math.floor(al(SOL + 1, H)), 1, 1); }
      for (let x = 0; x < W; x += 2) { f.fillStyle = '#0e2a22'; f.fillRect(x, SOL, 1, 1); }
      // chemin de terre
      const c0 = BAS_HERBE + 1, c1 = PIEDS + 1;
      f.fillStyle = '#4d4048'; f.fillRect(0, c0, W, c1 - c0);
      f.fillStyle = '#3a3038'; f.fillRect(0, c0, W, 1); f.fillRect(0, c1 - 1, W, 1);
      for (let x = 0; x < W; x++) { if (Math.random() < .35) { f.fillStyle = '#163d33'; f.fillRect(x, c0, 1, 1); } if (Math.random() < .35) { f.fillStyle = '#163d33'; f.fillRect(x, c1 - 1, 1, 1); } }
      for (let i = 0; i < W / 4; i++) { f.fillStyle = Math.random() < .6 ? '#5e5058' : '#3f343c'; f.fillRect(Math.floor(al(0, W)), Math.floor(al(c0 + 2, c1 - 2)), Math.random() < .3 ? 2 : 1, 1); }
      // touffes d'herbes, panneau, barrière, fleurs et objet
      touffes = []; fleurs = []; balle = null;
      const panneau = PIX.panneau(), barriere = PIX.barriere(), pb = PIX.balle();
      let posPanneau = W > 260 ? Math.round(al(.18, .3) * W) : -999;
      let x = Math.round(al(-6, 10));
      while (x < W) {
        if (posPanneau > -999 && Math.abs(x - posPanneau) < 30) {
          posPanneau = -999;
          f.drawImage(barriere, x, BAS_HERBE - barriere.height + 1);
          f.drawImage(panneau, x + barriere.width + 2, BAS_HERBE - panneau.height + 1);
          x += barriere.width + panneau.width + 8;
          continue;
        }
        const n = 1 + Math.floor(al(1, 4.9));
        touffes.push({ x, n, agite: 0 });
        x += n * 16 + 2 + Math.round(al(10, 44));
        const libre = x - 4;
        if (Math.random() < .7) for (let k = 0; k < 2 + Math.floor(al(0, 3)); k++) fleurs.push({ x: Math.round(libre - al(2, 18)), y: Math.round(al(SOL + 2, BAS_HERBE - 5)), c: ['#e8344e', '#ffcc33', '#f4f1ff', '#ff7aa8'][Math.floor(al(0, 4))], d: Math.floor(al(0, 2)) });
        if (!balle && Math.random() < .25 && x < W - 20) { balle = { x: libre - 12, y: BAS_HERBE - 9 }; }
      }
      for (let k = 0; k < W / 30; k++) fleurs.push({ x: Math.round(al(0, W)), y: Math.round(al(c1 + 1, H - 4)), c: ['#e8344e', '#ffcc33', '#f4f1ff'][Math.floor(al(0, 3))], d: Math.floor(al(0, 2)) });
      if (balle) f.drawImage(pb, balle.x, balle.y);
    }

    // Acteurs
    let sauvage = null, dresseur = null, t0 = performance.now(), prochainSauvage = 1500, prochainDresseur = 2500;
    // Dresseurs en balade : sprites de déplacement de Pokémon Émeraude (img/marcheurs.png, une ligne de 9 images 16 × 32 par dresseur).
    let marcheurs = null;
    planche('img/marcheurs.png').then((img) => { marcheurs = img; });
    const images = new Map();
    function marcheur(ligne, k, droite) {
      const cle = ligne + '-' + k + (droite ? 'd' : 'g');
      if (!images.has(cle)) {
        const c = document.createElement('canvas'); c.width = 16; c.height = 32;
        const x = c.getContext('2d');
        if (droite) { x.translate(16, 0); x.scale(-1, 1); }
        x.drawImage(marcheurs, k * 16, ligne * 32, 16, 32, 0, 0, 16, 32);
        images.set(cle, c);
      }
      return images.get(cle);
    }
    function nouveauSauvage(t) {
      if (!touffes.length) return;
      const tf = touffes[Math.floor(Math.random() * touffes.length)];
      if (tf.x < 0 || tf.x + tf.n * 16 > W) return;
      const id = 1 + Math.floor(Math.random() * 1025);
      sprite(id).then((p) => {
        if (!p) return;
        const col = Math.floor(Math.random() * tf.n);
        sauvage = { p, tf, x: tf.x + col * 16 + 8 - p.box.w / 6, debut: t, cri: Math.random() < .4 };
      });
    }
    function nouveauDresseur(t) {
      const droite = Math.random() < .5;
      const id = 1 + Math.floor(Math.random() * 1025);
      sprite(id).then((p) => {
        if (!marcheurs) return;
        dresseur = { ligne: Math.floor(Math.random() * (marcheurs.height / 32)), droite, debut: t, p, pause: Math.random() < .5 ? al(.25, .7) : -1, pauseFin: 0 };
      });
    }

    function image(t) {
      g.setTransform(S, 0, 0, S, 0, 0);
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, W, H);
      g.drawImage(fond, 0, 0);
      const pas = Math.floor(t / 450) % 2;
      for (const fl of fleurs) g.drawImage(PIX.fleurCache(pas ^ fl.d, fl.c), fl.x, fl.y);
      if (balle && (t % 3000) < 400) { g.fillStyle = '#fff6c9'; const k = Math.floor((t % 3000) / 100); const cx = balle.x + 6, cy = balle.y + 1; if (k % 2 === 0) { g.fillRect(cx, cy - 2, 1, 5); g.fillRect(cx - 2, cy, 5, 1); } else g.fillRect(cx, cy, 1, 1); }
      // Pokémon sauvage : il sort la tête des herbes, regarde, puis replonge
      if (sauvage) {
        const e = (t - sauvage.debut) / 1000, D = 3.4;
        if (e > D) sauvage = null;
        else {
          const visible = Math.min(15, Math.max(7, sauvage.p.box.h / 3 * .6));
          const sortie = e < .35 ? e / .35 : e > D - .35 ? (D - e) / .35 : 1;
          const haut = HAUT_HERBE + 4 - Math.round(sortie * visible) + (e > .35 && e < D - .35 && Math.floor(e * 4) % 2 ? 1 : 0);
          g.save(); g.beginPath(); g.rect(0, 0, W, BAS_HERBE - 2); g.clip();
          dessinePoke(sauvage.p, sauvage.x, haut + sauvage.p.box.h / 3, false);
          g.restore();
          sauvage.tf.agite = e < .5 || (e > 1.4 && e < 1.6) || e > D - .5 ? 1 : 0;
          if (sauvage.cri && e > .5 && e < 1.6) bulle(sauvage.x + sauvage.p.box.w / 6, haut - 3);
        }
      }
      for (const tf of touffes) {
        const ag = tf.agite && Math.floor(t / 120) % 2;
        g.drawImage(herbe(tf.n, ag), tf.x - 1, BAS_HERBE - 15);
        tf.agite = 0;
      }
      // Dresseur en balade avec son Pokémon
      if (dresseur) {
        const v = 26, e = (t - dresseur.debut) / 1000;
        const total = (W + 90) / v;
        let parcours = e;
        if (dresseur.pause > 0) {
          const tp = dresseur.pause * total;
          if (e > tp && e < tp + 1.3) parcours = tp; else if (e >= tp + 1.3) parcours = e - 1.3;
        }
        if (parcours > total) dresseur = null;
        else {
          const arret = parcours !== e && e - parcours < 1.3 && e > dresseur.pause * total;
          const d = parcours * v;
          const x = dresseur.droite ? -60 + d : W + 30 - d;
          const spr = marcheur(dresseur.ligne, arret ? 2 : [7, 2, 8, 2][Math.floor(t / 150) % 4], dresseur.droite);
          if (dresseur.p) {
            const px = dresseur.droite ? x - dresseur.p.box.w / 3 - 4 : x + 20;
            const saut = !arret && Math.floor(t / 180) % 2 ? 1 : 0;
            dessinePoke(dresseur.p, px, PIEDS + 1 - saut, dresseur.droite);
          }
          g.drawImage(spr, Math.round(x), PIEDS + 1 - spr.height);
          if (arret) bulle(Math.round(x) + 8, PIEDS - spr.height + 4);
        }
      }
    }
    function bulle(x, y) {
      x = Math.round(x); y = Math.round(y);
      g.fillStyle = '#0d1424'; g.fillRect(x - 4, y - 10, 9, 10); g.fillRect(x - 1, y, 3, 2);
      g.fillStyle = '#f4f1ff'; g.fillRect(x - 3, y - 9, 7, 8); g.fillRect(x, y - 1, 1, 2);
      g.fillStyle = '#e8344e'; g.fillRect(x, y - 8, 1, 4); g.fillRect(x, y - 3, 1, 1);
    }

    function boucle() {
      const t = performance.now() - t0;
      if (!document.hidden) {
        if (!sauvage && t > prochainSauvage) { nouveauSauvage(t); prochainSauvage = t + al(4200, 7000); }
        if (!dresseur && t > prochainDresseur) { nouveauDresseur(t); prochainDresseur = t + al(9000, 16000); }
        image(t);
      }
      setTimeout(boucle, 1000 / 12);
    }
    let attente;
    addEventListener('resize', () => { clearTimeout(attente); attente = setTimeout(() => { if (Math.ceil(innerWidth / (innerWidth >= 1100 ? 3 : 2)) !== W) { construit(); image(performance.now() - t0); } }, 200); });
    construit();
    image(0);
    if (!calme) quandSprites(() => setTimeout(boucle, 300));
    return wrap;
  }

  // Décor permanent : sol de plateau, grande Poké Ball, silhouettes de Pokémon qui dérivent.
  (function decor() {
    const d = h('div', { id: 'decor', 'aria-hidden': 'true' }, h('div', { class: 'sol' }), h('div', { class: 'embleme' }, h('i')));
    const silh = [];
    for (let i = 0; i < 9; i++) {
      const img = h('img', { alt: '', class: 'silh', decoding: 'async' });
      const place = () => {
        const src = spriteSrc(1 + hasard(1025));
        if (src) img.src = src;
        const t = 150 + hasard(170);
        img.style.cssText = `left:${hasard(92)}%;top:${8 + hasard(78)}%;width:${t}px;--d:${26 + hasard(20)}s;--x:${hasard(2) ? '' : '-'}${30 + hasard(60)}px;animation-delay:-${hasard(20)}s`;
      };
      img.addEventListener('animationiteration', place);
      silh.push(place);
      d.append(img);
    }
    quandSprites(() => silh.forEach((f) => f()));
    d.append(route());
    document.body.prepend(d);
  })();

  // ---------- Photo de profil : un dresseur des jeux (sprites de Pokémon Émeraude) ----------
  const DRESSEURS = ["Brice", "Flora", "Red", "Leaf", "Timmy", "Pierre Rochard", "Marc (Maître)", "Roxanne", "Bastien", "Voltère", "Adriane", "Norman", "Alizée", "Lévy et Tatia", "Juan", "Damien", "Spectra", "Glacia", "Aragon", "Arthur", "Max", "Admin Aqua", "Admin Aqua (F)", "Sbire Aqua", "Sbire Aqua (F)", "Sbire Magma", "Sbire Magma (F)", "Dame de la Tour", "As du Dôme", "Gardien du Palais", "Reine de l'Arène", "Chef de l'Usine", "Reine du Tube", "Roi de la Pyramide", "Gamin", "Fillette", "Scout", "Fana Insecte", "Campeur", "Pique-Niqueuse", "Montagnard", "Pêcheur", "Marin", "Topdresseur", "Topdresseuse", "Karatéka", "Combattante", "Expert", "Experte", "Petit Ninja", "Kinésiste", "Kinésiste (F)", "Mystimaniac", "Fana Ruines", "Pokémaniac", "Collectionneur", "Pyromane", "Guitariste", "Ornithologue", "Dresseur de dragons", "Gentleman", "Dame", "Gosse de riche", "Canon", "Aromadame", "Dame à ombrelle", "Éleveur", "Éleveuse", "Ranger", "Rangeuse", "Pokéfan", "Pokéfan (F)", "Écolier", "Écolière", "Reporters", "Nageur", "Nageuse", "Petit nageur", "Petite nageuse", "Triathlète cycliste", "Triathlète cycliste (F)", "Triathlète coureur", "Triathlète coureuse", "Triathlète nageur", "Triathlète nageuse", "Jumelles", "Jeune couple", "Vieux couple", "Frère et sœur", "Senior et junior"];
  // Planche img/dresseurs.png : 10 colonnes de 64 × 64 px, dans l'ordre de DRESSEURS.
  const plancheDresseurs = planche('img/dresseurs.png');
  const portraits = new Map();
  function portrait(n) {
    if (!portraits.has(n)) portraits.set(n, plancheDresseurs.then((img) => {
      if (!img) return '';
      const c = document.createElement('canvas'); c.width = c.height = 64;
      c.getContext('2d').drawImage(img, (n % 10) * 64, Math.floor(n / 10) * 64, 64, 64, 0, 0, 64, 64);
      return c.toDataURL();
    }));
    return portraits.get(n);
  }
  const monAvatar = () => { const v = store.get('avatar'); const n = Number(v); return v !== null && v !== '' && n >= 0 && n < DRESSEURS.length ? n : null; };
  if (monAvatar() === null) store.set('avatar', String(hasard(4)));
  // <img> d'un dresseur, rempli dès que la planche est chargée.
  function imgDresseur(n, cls) {
    const img = h('img', { alt: '', class: cls || null, title: DRESSEURS[n] || null });
    img.dataset.n = n;
    portrait(n).then((src) => { if (src && Number(img.dataset.n) === n) img.src = src; });
    return img;
  }
  const changeDresseur = (img, n) => { img.dataset.n = n; img.title = DRESSEURS[n]; portrait(n).then((src) => { if (src && Number(img.dataset.n) === n) img.src = src; }); };
  // Grille de choix : appelle choisir(n) au clic.
  function grilleAvatars(actuel, choisir) {
    const boutons = DRESSEURS.map((nom, n) => h('button', { type: 'button', class: 'av-choix' + (n === actuel ? ' on' : ''), title: nom, 'aria-label': nom, 'aria-pressed': String(n === actuel),
      onclick: (e) => { grille.querySelectorAll('.av-choix').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true'); choisir(n); } }, imgDresseur(n)));
    const grille = h('div', { class: 'av-grille' }, boutons);
    return grille;
  }

  // ---------- Carte dresseur : parties et victoires, gardées sur l'appareil ----------
  const mesStats = () => {
    try { const s = JSON.parse(store.get('stats') || '{}'); return { parties: s.parties | 0, victoires: s.victoires | 0, vus: s.vus || [], gagnes: s.gagnes || [] }; }
    catch (e) { return { parties: 0, victoires: 0, vus: [], gagnes: [] }; }
  };
  const statsPubliques = () => { const s = mesStats(); return { parties: s.parties, victoires: s.victoires }; };
  const ligneStats = (s) => !s || !s.parties ? 'Première partie' : s.parties + (s.parties > 1 ? ' parties' : ' partie') + ' · ' + s.victoires + (s.victoires > 1 ? ' victoires' : ' victoire');
  // En fin de partie : on compte la partie une seule fois, et la victoire quand le résultat Showdown est donné.
  function suiviStats() {
    if (!etat || etat.phase !== 'fin' || (window.__ecranPartage && etat.moi !== 0)) return;
    const s = mesStats();
    const cle = etat.code + '-' + etat.partie;
    let change = false;
    if (!s.vus.includes(cle)) { s.vus = s.vus.concat(cle).slice(-60); s.parties++; change = true; }
    const deja = s.gagnes.includes(cle);
    if (etat.gagnant === etat.moi && !deja) { s.gagnes = s.gagnes.concat(cle).slice(-60); s.victoires++; change = true; }
    else if (etat.gagnant != null && etat.gagnant !== etat.moi && deja) { s.gagnes = s.gagnes.filter((x) => x !== cle); s.victoires = Math.max(0, s.victoires - 1); change = true; }
    if (change) { store.set('stats', JSON.stringify(s)); emit('stats', statsPubliques()); }
  }

  function carteDresseur(nomIn, surChange) {
    const s = mesStats();
    const grand = imgDresseur(monAvatar(), 'cd-img');
    const titre = h('b', { class: 'cd-nom' }, (nomIn.value.trim() || 'Dresseur').toUpperCase());
    nomIn.addEventListener('input', () => { titre.textContent = (nomIn.value.trim() || 'Dresseur').toUpperCase(); });
    const qui = h('small', { class: 'cd-qui' }, DRESSEURS[monAvatar()]);
    const taux = s.parties ? Math.round(100 * s.victoires / s.parties) + ' %' : '–';
    return h('div', { class: 'carte-dresseur' },
      h('div', { class: 'cd-haut' },
        h('div', { class: 'cd-portrait holo-bord' }, grand),
        h('div', { class: 'cd-infos' }, h('span', { class: 'cd-label' }, 'Carte dresseur'), titre, qui,
          h('dl', { class: 'cd-stats' },
            h('div', {}, h('dt', {}, 'Parties'), h('dd', {}, s.parties)),
            h('div', {}, h('dt', {}, 'Victoires'), h('dd', {}, s.victoires)),
            h('div', {}, h('dt', {}, 'Réussite'), h('dd', {}, taux))))),
      h('p', { class: 'cd-aide' }, 'Choisis le dresseur qui te représente :'),
      grilleAvatars(monAvatar(), (n) => { store.set('avatar', String(n)); changeDresseur(grand, n); qui.textContent = DRESSEURS[n]; surChange(n); }));
  }

  function accueil() {
    const code = (params.get('salon') || '').toUpperCase();
    const nom = h('input', { type: 'text', id: 'nom', maxlength: 20, placeholder: 'Ton pseudo', 'aria-label': 'Ton pseudo', autocomplete: 'nickname', value: store.get('nom') || '' });
    const codeIn = h('input', { type: 'text', id: 'code', class: 'code-in', maxlength: 4, placeholder: 'ABCD', 'aria-label': 'Code du salon', autocomplete: 'off', value: code });
    const pseudo = () => { const n = nom.value.trim(); if (!n) { toast('Choisis un pseudo.'); nom.focus(); return null; } store.set('nom', n); return n; };
    const rejoindre = (c) => { const n = pseudo(); if (!n) return; if (!/^[A-Z]{4}$/.test(c || '')) { toast('Le code fait 4 lettres.'); codeIn.focus(); return; } socket.emit('rejoindre', { code: c, nom: n, avatar: monAvatar(), stats: statsPubliques() }, (r) => r && r.erreur && toast(r.erreur)); };
    const apercu = imgDresseur(monAvatar(), 'av-img');
    const hoteG = imgDresseur(monAvatar(), 'hote hote-g');
    const carte = carteDresseur(nom, (n) => { changeDresseur(apercu, n); changeDresseur(hoteG, n); });
    const tiroir = h('div', { class: 'tiroir', hidden: true }, carte);
    const joindre = h('div', { class: 'tiroir joindre-ligne', hidden: true },
      h('span', {}, 'Code du salon'), codeIn,
      h('button', { class: 'btn', onclick: () => rejoindre(codeIn.value.trim().toUpperCase()) }, 'Entrer'));
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') rejoindre(codeIn.value.trim().toUpperCase()); });
    const ouvre = (t, autre, btn) => { t.hidden = !t.hidden; autre.hidden = true; if (btn) btn.setAttribute('aria-expanded', String(!t.hidden)); };
    const avBtn = h('button', { type: 'button', class: 'av-btn', title: 'Ma carte dresseur', 'aria-label': 'Ma carte dresseur et ma photo de profil', 'aria-expanded': 'false',
      onclick: (e) => ouvre(tiroir, joindre, e.currentTarget) }, h('span', { class: 'av-rond' }, apercu), h('span', { class: 'av-edit', 'aria-hidden': 'true' }, '✎'));
    const ligne = h('div', { class: 'console-ligne' }, avBtn, nom,
      code
        ? h('button', { class: 'btn', onclick: () => rejoindre(code) }, ico('pokeball'), 'Rejoindre ' + code)
        : [h('button', { class: 'btn', onclick: () => { const n = pseudo(); if (n) emit('creer', { nom: n, avatar: monAvatar(), stats: statsPubliques() }); } }, ico('pokeball'), 'Créer un salon'),
          h('button', { class: 'btn ghost', 'aria-expanded': 'false', onclick: (e) => { ouvre(joindre, tiroir, e.currentTarget); if (!joindre.hidden) codeIn.focus(); } }, 'Rejoindre')]);
    nom.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !code) { const n = pseudo(); if (n) emit('creer', { nom: n, avatar: monAvatar(), stats: statsPubliques() }); } });
    return h('section', { class: 'accueil accueil2' },
      h('div', { class: 'onair' }, h('i'), code ? 'Invitation au salon ' + code : 'En direct · 1v1 · 6 rounds'),
      h('h1', { class: 'logo' }, h('span', { class: 'l1' }, 'Starters'), h('span', { class: 'l2' }, "à l'aveugle")),
      h('p', { class: 'accroche' }, 'Ton adversaire voit les trois Pokémon. ', h('b', {}, 'Toi, seulement ses indices.')),
      h('div', { class: 'console2' }, ligne, joindre, tiroir),
      h('details', { class: 'comment' }, h('summary', {}, 'Comment on joue, en 20 secondes'),
        h('div', { class: 'etapes' }, [
          ['oeil', 'Il voit, pas toi', 'Chaque round, trois Pokémon mystères sont tirés parmi tout le Pokédex. Seul ton adversaire les voit.'],
          ['ampoule', 'Les indices tombent', 'Couleurs shiny, cri, Pokédex, stats… Il dévoile les indices du mode, un par un, quand il veut.'],
          ['pokeball', 'Tu recrutes', 'Tu choisis ton starter à l’aveugle. Six rounds plus tard, export de l’équipe et combat sur Showdown.'],
        ].map(([i, t, p], k) => h('div', { class: 'etape' }, h('div', { class: 'etape-ico' }, ico(i), h('b', {}, k + 1)), h('h3', {}, t), h('p', {}, p))))),
      plateau(hoteG));
  }

  // Trois podiums sous les projecteurs : les silhouettes des starters d'une région, qui changent toutes les quelques secondes.
  function plateau(hoteG) {
    let g = hasard(9);
    const imgs = [0, 1, 2].map(() => h('img', { alt: '', class: 'podium-silh' }));
    const region = h('b', {}, REGIONS[g]);
    const p = h('div', { class: 'plateau', 'aria-hidden': 'true' },
      h('div', { class: 'projos' }, h('i'), h('i'), h('i')),
      h('div', { class: 'qui' }, 'Qui est-ce ?'),
      hoteG, imgDresseur(4 + hasard(DRESSEURS.length - 4), 'hote hote-d'),
      h('div', { class: 'podiums' }, imgs.map((img, i) => h('div', { class: 'podium' },
        h('div', { class: 'podium-halo' }), img, h('div', { class: 'socle' }, h('span', {}, '?'), h('em', {}, ['A', 'B', 'C'][i]))))),
      h('div', { class: 'plateau-legende' }, 'Starters de ', region));
    const montre = () => imgs.forEach((img, i) => { const s = spriteSrc(STARTERS[g][i]); if (s) img.src = s; });
    quandSprites(montre);
    const tic = setInterval(() => {
      if (!p.isConnected) { clearInterval(tic); return; }
      if (calme) return;
      p.classList.add('change');
      setTimeout(() => { g = (g + 1) % 9; region.textContent = REGIONS[g]; montre(); p.classList.remove('change'); }, 450);
    }, 3800);
    return p;
  }

  function salon() {
    const hote = etat.moi === etat.hote;
    const r = etat.reglages;
    const lien = location.origin + '/?salon=' + etat.code;
    const modeDe = (id) => etat.modes.find((x) => x.id === id);
    const optsModes = (val) => [h('option', { value: 'aleatoire', selected: val === 'aleatoire' }, 'Aléatoire')]
      .concat(etat.modes.map((m) => h('option', { value: m.id, selected: m.id === val }, m.no + '. ' + m.nom)));
    const maj = (patch) => emit('reglages', Object.assign({}, r, patch));
    const dresseur = (i) => {
      const j = etat.joueurs[i];
      const cote = i === 0 ? 'rouge' : 'bleu';
      if (!j) return h('div', { class: 'dresseur vide ' + cote }, h('div', { class: 'avatar ombre' }, h('span', { class: 'cadre' }, pokeball('attente'))), h('div', {}, h('b', {}, 'En attente…'), h('small', {}, 'Envoie le lien à ton adversaire')));
      const moi = i === etat.moi;
      return h('div', { class: 'dresseur ' + cote + (fresh('j' + i + j.nom) ? ' arrive' : '') },
        h(moi ? 'button' : 'div', { class: 'avatar' + (moi ? ' modifiable' : ''), type: moi ? 'button' : null, title: moi ? 'Changer ma photo de profil' : null, 'aria-label': moi ? 'Changer ma photo de profil' : null,
          onclick: moi ? () => { avatarOuvert = !avatarOuvert; render(); } : null },
          h('span', { class: 'cadre' }, j.avatar != null ? imgDresseur(j.avatar) : null), moi ? h('span', { class: 'initiale' }, ico('formes')) : null),
        h('div', {}, h('b', {}, j.nom),
          h('small', {}, h('span', { class: 'dot' + (j.connecte ? '' : ' off') }), (j.connecte ? 'Connecté' : 'Déconnecté') + (i === etat.hote ? ' · hôte' : '') + (i === etat.moi ? ' · toi' : '')),
          h('small', { class: 'stats-ligne' }, ligneStats(j.stats))));
    };
    const tous = h('select', { id: 'tous', disabled: !hote, onchange: (e) => maj({ modes: Array(etat.rounds).fill(e.target.value) }) },
      h('option', { value: '' }, 'Choisir…'), optsModes(''));
    const tuile = (m, i) => {
      const premier = r.modes.indexOf(m);
      const md = modeDe(m);
      return h('div', { class: 'tuile', style: '--c:' + (COULEUR_MODE[m] || '#ffcc33') },
        h('div', { class: 'tuile-tete' },
          h('span', { class: 'tuile-num' }, h('small', {}, 'Round'), String(i + 1).padStart(2, '0')),
          h('span', { class: 'tuile-ico' }, ico(m in COULEUR_MODE ? m : 'aleatoire'))),
        h('label', { class: 'sr', for: 'mode' + i }, 'Mode du round ' + (i + 1)),
        h('select', { id: 'mode' + i, disabled: !hote, onchange: (e) => { const modes = r.modes.slice(); modes[i] = e.target.value; maj({ modes }); } }, optsModes(m)),
        h('p', { class: 'aide' }, premier < i ? 'Comme au round ' + (premier + 1) + '.'
          : m === 'aleatoire' ? 'Un mode tiré au hasard parmi ceux cochés plus bas.' : (md || {}).desc));
    };
    const bascule = (k, label, icone) => h('label', { class: 'bascule' },
      h('input', { type: 'checkbox', class: 'sr', disabled: !hote, checked: r[k], onchange: (e) => maj({ [k]: e.target.checked }) }),
      ico(icone), h('span', {}, label), h('i', { class: 'interrupteur' }));
    return h('section', { class: 'salon' },
      h('div', { class: 'salon-tete' },
        h('div', {},
          h('div', { class: 'onair' }, h('i'), 'Salon ouvert'),
          h('div', { class: 'code-tuiles', 'aria-label': 'Code du salon ' + etat.code }, etat.code.split('').map((c) => h('span', { 'aria-hidden': 'true' }, c)))),
        h('div', { class: 'partage' },
          h('button', { class: 'btn ghost', onclick: (e) => copier(lien, e.currentTarget) }, ico('lien'), 'Copier le lien'),
          h('small', { class: 'muted' }, 'Envoie-le à ton adversaire pour qu’il rejoigne le plateau.'))),
      h('div', { class: 'versus' }, dresseur(0), h('div', { class: 'vs' }, 'VS'), dresseur(1)),
      avatarOuvert ? h('div', { class: 'panel bloc av-panneau' },
        h('div', { class: 'bloc-tete' }, h('span', { class: 'bloc-ico' }, ico('pokeball')), h('div', {}, h('h2', { class: 'h2' }, 'TA PHOTO DE PROFIL'), h('p', { class: 'muted' }, 'Choisis le dresseur qui te représente.'))),
        grilleAvatars((etat.joueurs[etat.moi] || {}).avatar, (n) => { store.set('avatar', String(n)); avatarOuvert = false; emit('avatar', { id: n }); })) : null,
      h('div', { class: 'panel bloc' },
        h('div', { class: 'bloc-tete' }, h('span', { class: 'bloc-ico' }, ico('combat')),
          h('div', {}, h('h2', { class: 'h2' }, 'LE PROGRAMME'), h('p', { class: 'muted' }, 'Un mode d’indices par round. ' + (hote ? 'Compose l’émission.' : 'Seul l’hôte peut modifier les réglages.')))),
        h('div', { class: 'field tous' }, h('label', { for: 'tous' }, 'Le même mode pour tous les rounds'), tous),
        h('div', { class: 'tuiles' }, r.modes.map(tuile)),
        h('details', { class: 'regles' }, h('summary', {}, ico('pokedex'), 'Comment marche chaque mode ?'),
          h('dl', {}, etat.modes.map((m) => [h('dt', { style: '--c:' + (COULEUR_MODE[m.id] || '#ffcc33') }, ico(m.id), m.no + '. ' + m.nom), h('dd', {}, m.regle)]))),
        r.modes.includes('aleatoire') ? h('div', { class: 'field' }, h('label', {}, "Modes possibles pour l'aléatoire"),
          h('div', { class: 'chips' }, etat.modes.map((m) => h('label', { class: 'chip', style: '--c:' + (COULEUR_MODE[m.id] || '#ffcc33') },
            h('input', { type: 'checkbox', title: m.regle, disabled: !hote, checked: r.aleatoire.includes(m.id), onchange: (e) => maj({ aleatoire: e.target.checked ? r.aleatoire.concat(m.id) : r.aleatoire.filter((x) => x !== m.id) }) }), ico(m.id), m.nom)))) : null),
      h('div', { class: 'panel bloc' },
        h('div', { class: 'bloc-tete' }, h('span', { class: 'bloc-ico' }, ico('pokeball')),
          h('div', {}, h('h2', { class: 'h2' }, 'POKÉMON POSSIBLES'), h('p', { class: 'muted' }, 'Les starters mystères sont tirés parmi ceux-là.'))),
        h('div', { class: 'bascules' }, bascule('formes', 'Formes alternatives et régionales', 'formes'), bascule('megas', 'Méga-évolutions', 'megas'), bascule('legendaires', 'Légendaires et fabuleux', 'legendaires')),
        h('div', { class: 'field' }, h('label', {}, 'Générations'),
          h('div', { class: 'gens' }, REGIONS.map((reg, k) => {
            const g = k + 1;
            return h('label', { class: 'gen' },
              h('input', { type: 'checkbox', class: 'sr', disabled: !hote, checked: r.gens.includes(g), onchange: (e) => maj({ gens: e.target.checked ? r.gens.concat(g) : r.gens.filter((x) => x !== g) }) }),
              h('span', { class: 'gen-sprites' }, STARTERS[k].map((id) => { const s = spriteSrc(id); return s ? h('img', { src: s, alt: '' }) : null; })),
              h('b', {}, 'Gén ' + g), h('small', {}, reg));
          })))),
      hote ? h('button', { class: 'btn grand lancer', disabled: etat.joueurs.length < 2, onclick: () => emit('lancer') }, ico('pokeball'), etat.joueurs.length < 2 ? 'En attente du deuxième joueur' : 'Lancer la partie')
        : h('p', { class: 'attente-hote' }, pokeball('attente'), "En attente du lancement par l'hôte…"));
  }

  function entete() {
    const pips = [];
    for (let i = 0; i < etat.rounds; i++) pips.push(h('i', { class: i < etat.round ? 'done' : i === etat.round ? 'now' : '' }));
    const dev = etat.joueurs[etat.devineur], mai = etat.joueurs[etat.maitre];
    const moiDevine = etat.moi === etat.devineur;
    let who, sub;
    if (etat.phase === 'revelation') { who = 'RÉVÉLATION'; sub = moiDevine ? mai.nom + ' révèle tes starters' : dev.nom + ' a fait son choix : à toi de révéler'; }
    else if (moiDevine) { who = 'À TOI, ' + dev.nom.toUpperCase(); sub = mai.nom + ' te dévoile les indices'; }
    else { who = 'TU ES LE MAÎTRE DU JEU'; sub = 'Dévoile les indices à ' + dev.nom + ' quand tu veux'; }
    return h('div', { class: 'top' },
      h('div', {},
        h('div', { class: 'eyebrow' }, etat.mode.nom + ' · tour ' + (etat.tour + 1) + '/2',
          h('details', { class: 'regle-pop' }, h('summary', { 'aria-label': 'Règle du mode' }, '?'), h('p', {}, etat.mode.regle || etat.mode.desc))),
        h('div', { class: 'big' }, 'ROUND ' + (etat.round + 1)),
        h('div', { class: 'pips' }, pips)),
      h('div', { class: 'who' }, who, h('small', {}, sub)));
  }

  function rendIndice(ind, cle) {
    const v = ind.valeur;
    const neuf = ind.visible && cle && fresh(cle);
    const cls = 'indice ' + ind.type + (ind.visible ? '' : ' cache') + (neuf ? ' enter' : '');
    if (ind.type === 'palette') {
      return h('div', { class: cls }, h('div', { class: 'stripes', role: 'img', 'aria-label': 'Palette shiny : ' + v.map((c) => c[1] + ' ' + c[0] + ' %').join(', ') },
        v.map((c) => h('div', { style: 'flex:' + c[0] + ' 1 0;background:' + c[1] }, h('span', {}, c[0] + ' %')))));
    }
    const body = [h('div', { class: 't' }, ind.titre)];
    if (ind.type === 'audio') {
      body.push(h('button', { class: 'btn', onclick: () => { const a = new Audio(v); a.play().catch(() => toast('Lecture impossible sur ce navigateur (fichier .ogg).')); } }, '▶ Écouter'));
    } else if (ind.type === 'texte') body.push(h('p', {}, v));
    else if (ind.type === 'grand') body.push(h('div', { class: 'v' }, v));
    else if (ind.type === 'tags') body.push(h('div', { class: 'tags' }, v.map((t) => h('span', {}, t))));
    else if (ind.type === 'stats') {
      body.push(h('div', { class: 'stats' }, Object.keys(STAT_NOMS).map((k) => [
        h('span', {}, STAT_NOMS[k]), h('div', { class: 'bar', style: 'width:' + Math.min(100, v[k] / 2) + '%' }), h('span', {}, v[k])])));
    } else if (ind.type === 'zoom') {
      if (v.src) body.push(h('div', { class: 'zoom', role: 'img', 'aria-label': 'Gros plan', style: `background-image:url(${v.src});background-size:${v.zoom * 100}%;background-position:${v.x}% ${v.y}%` }));
    }
    return h('div', { class: cls }, body);
  }

  // Le zoom n'affiche que le plan le plus récent ; les autres indices s'empilent.
  function indicesAffiches(list, maitre) {
    if (maitre) return list;
    const z = list.filter((i) => i.type === 'zoom');
    return z.length ? list.filter((i) => i.type !== 'zoom').concat(z[z.length - 1]) : list;
  }

  function round() {
    const moiMaitre = etat.moi === etat.maitre;
    const base = etat.round + '-' + etat.tour + '-';
    const cartes = etat.cartes.map((c, i) => {
      const L = LETTRES[i];
      if (moiMaitre) {
        const libre = etat.mode.libre;
        const idT = 'libre' + i;
        const ta = libre ? h('textarea', { id: idT, rows: 2, maxlength: 140, placeholder: 'Ex. : il vit dans les volcans', oninput: (e) => { brouillons[idT] = e.target.value; } }) : null;
        if (ta) ta.value = brouillons[idT] || '';
        return h('article', { class: 'carte' },
          h('div', { class: 'maitre-tete' }, h('img', { src: c.sprite, alt: '' }), h('div', {}, h('b', {}, L + ' · ' + c.nom + (c.shiny ? ' ✨' : '')), h('span', { class: 'muted' }, c.types.join(' / ')))),
          h('div', { class: 'corps' }, c.indices.map((ind, n) => rendIndice(ind, ind.visible ? base + i + '-' + n : null)),
            h('div', { class: 'actions' },
              libre ? [ta, h('button', { class: 'btn', onclick: () => { const t = (brouillons[idT] || '').trim(); if (!t) return toast('Écris un indice.'); brouillons[idT] = ''; emit('indiceLibre', { carte: i, texte: t }); } }, 'Envoyer l’indice')]
                : c.reveles < c.total ? h('button', { class: 'btn', onclick: () => emit('devoiler', { carte: i }) }, `Dévoiler l'indice ${c.reveles + 1}/${c.total}`)
                  : h('span', { class: 'badge non' }, 'Tout est dévoilé'))));
      }
      const ouvre = c.indices.length > 0 && fresh(base + i + '-rideau');
      const corps = c.indices.length
        ? indicesAffiches(c.indices, false).map((ind) => rendIndice(ind, base + i + '-' + c.indices.indexOf(ind)))
        : [h('div', { class: 'rideau', 'aria-label': 'Aucun indice pour le moment' }, '?')];
      if (ouvre) corps.push(h('div', { class: 'ouverture', 'aria-hidden': 'true' }, h('i'), h('i')));
      return h('article', { class: 'carte' },
        h('div', { class: 'corps' }, corps),
        h('div', { class: 'pied' }, h('b', {}, 'STARTER ' + L),
          h('button', { class: 'btn', onclick: () => emit('recruter', { carte: i }) }, 'Recruter')));
    });
    const entree = fresh('cartes-' + base);
    return [entete(), h('div', { class: 'cartes vue' + (entree ? ' entree' : '') }, cartes)];
  }

  function revelation() {
    const moiMaitre = etat.moi === etat.maitre;
    const base = etat.round + '-' + etat.tour + '-';
    let fete = false;
    const cartes = etat.cartes.map((c, i) => {
      const choisi = i === etat.choix;
      const pied = h('div', { class: 'pied' }, h('b', {}, 'STARTER ' + LETTRES[i]),
        moiMaitre && !c.devoilee ? h('button', { class: 'btn', onclick: () => emit('reveler', { carte: i }) }, 'Révéler') : null);
      if (c.devoilee) {
        const neuf = fresh('rev-' + base + i);
        if (neuf && choisi) fete = true;
        return h('article', { class: 'carte' + (choisi ? ' gagne' : '') + (neuf ? ' flipone' : '') },
          h('div', { class: 'revele' + (c.shiny ? ' shiny' : '') }, h('img', { src: c.sprite, alt: '' }), h('b', {}, c.nom + (c.shiny ? ' ✨' : '')), h('span', { class: 'muted' }, c.types.join(' / ')),
            h('span', { class: 'badge' + (choisi ? '' : ' non') }, choisi ? 'Recruté' : 'Laissé de côté')), pied);
      }
      if (moiMaitre) {
        return h('article', { class: 'carte attente' + (choisi ? ' choisie' : '') },
          h('div', { class: 'revele' }, h('img', { src: c.sprite, alt: '' }), h('b', {}, c.nom + (c.shiny ? ' ✨' : '')),
            h('span', { class: 'badge' + (choisi ? '' : ' non') }, choisi ? 'Son choix · pas encore révélé' : 'Pas encore révélé')), pied);
      }
      return h('article', { class: 'carte' + (choisi ? ' choisie' : '') },
        h('div', { class: 'corps' }, h('div', { class: 'rideau', 'aria-label': 'Pas encore révélé' }, '?')),
        h('div', { class: 'pied' }, h('b', {}, 'STARTER ' + LETTRES[i]), choisi ? h('span', { class: 'badge' }, 'Ton choix') : null));
    });
    if (fete) setTimeout(() => confettis(160), 350);
    const toutes = etat.cartes.every((c) => c.devoilee);
    const dernier = etat.tour === 1 && etat.round === etat.rounds - 1;
    return [entete(), h('div', { class: 'cartes' }, cartes),
      toutes ? h('button', { class: 'btn continuer', onclick: () => emit('continuer') }, dernier ? 'Voir les équipes' : 'Continuer') : null];
  }

  // ---------- Image d'équipe à partager (Discord, réseaux) ----------
  const chargeImg = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  async function imageEquipe() {
    const j = etat.joueurs[etat.moi];
    const W = 1200, H = 630, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    try { await document.fonts.load('80px Anton'); await document.fonts.load('600 20px Barlow'); } catch (e) { /* polices système */ }
    const fond = g.createLinearGradient(0, 0, 0, H); fond.addColorStop(0, '#231a52'); fond.addColorStop(1, '#0b0a1c');
    g.fillStyle = fond; g.fillRect(0, 0, W, H);
    [[230, -20], [970, -20]].forEach(([x]) => { const p = g.createLinearGradient(0, 0, 0, H); p.addColorStop(0, 'rgba(255,214,120,.18)'); p.addColorStop(1, 'rgba(255,214,120,0)'); g.fillStyle = p; g.beginPath(); g.moveTo(x - 30, 0); g.lineTo(x + 30, 0); g.lineTo(x + 230, H); g.lineTo(x - 230, H); g.fill(); });
    const holo = g.createLinearGradient(0, 0, W, 0); ['#ff9ad5', '#ffe48a', '#8affc1', '#7fd8ff', '#c19bff'].forEach((col, k) => holo.addColorStop(k / 4, col));
    g.fillStyle = holo; g.fillRect(0, H - 8, W, 8);
    g.textBaseline = 'alphabetic';
    const or = g.createLinearGradient(0, 40, 0, 130); or.addColorStop(0, '#fff2b0'); or.addColorStop(.5, '#ffcc33'); or.addColorStop(1, '#ff9a1f');
    g.font = '400 92px Anton, Impact, sans-serif'; g.fillStyle = '#7a2a12'; g.fillText('STARTERS', 60, 136); g.fillStyle = or; g.fillText('STARTERS', 60, 128);
    const lw = g.measureText('STARTERS').width;
    g.save(); g.translate(70 + lw, 92); g.rotate(-0.04); g.fillStyle = '#e8334a'; g.fillRect(0, -40, 300, 56); g.font = '400 40px Anton, Impact, sans-serif'; g.fillStyle = '#fff'; g.fillText("À L'AVEUGLE", 18, 4); g.restore();
    g.font = '600 26px Barlow, sans-serif'; g.fillStyle = '#a9a3cc'; g.fillText('L’équipe recrutée à l’aveugle par', 60, 196);
    g.font = '400 54px Anton, Impact, sans-serif'; g.fillStyle = '#fff'; g.fillText(j.nom.toUpperCase(), 60, 256);
    const av = j.avatar != null ? await chargeImg(await portrait(j.avatar)) : null;
    g.imageSmoothingEnabled = false;
    if (av) g.drawImage(av, W - 60 - 192, 40, 192, 192);
    const imgs = await Promise.all(j.equipe.map((p) => chargeImg(p.sprite)));
    const cw = 172, gap = 12, x0 = (W - (6 * cw + 5 * gap)) / 2, y0 = 300;
    j.equipe.forEach((p, k) => {
      const x = x0 + k * (cw + gap);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.strokeStyle = 'rgba(255,204,51,.45)'; g.lineWidth = 2;
      g.beginPath(); g.roundRect ? g.roundRect(x, y0, cw, 236, 18) : g.rect(x, y0, cw, 236); g.fill(); g.stroke();
      if (imgs[k]) g.drawImage(imgs[k], x + (cw - 168) / 2, y0 + 6, 168, 168);
      g.font = '700 21px Barlow, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
      let n = p.nom; while (g.measureText(n).width > cw - 16 && n.length > 3) n = n.slice(0, -2) + '…';
      g.fillText(n, x + cw / 2, y0 + 206); g.textAlign = 'left';
    });
    g.font = '600 22px Barlow, sans-serif'; g.fillStyle = '#a9a3cc';
    const [a0, a1] = etat.joueurs;
    g.fillText('Score : ' + a0.nom + ' ' + etat.scores[0] + ' – ' + etat.scores[1] + ' ' + a1.nom, 60, H - 34);
    g.textAlign = 'right'; g.fillText('starters à l’aveugle · 1v1 Pokémon', W - 60, H - 34); g.textAlign = 'left';
    let url;
    try { url = c.toDataURL('image/png'); } catch (e) { toast('Impossible de créer l’image sur ce navigateur.'); return; }
    const fermer = () => voile.remove();
    const voile = h('div', { class: 'voile-img', role: 'dialog', 'aria-label': 'Image de ton équipe', onclick: (e) => { if (e.target === voile) fermer(); } },
      h('div', { class: 'voile-in' }, h('img', { src: url, alt: 'Ton équipe' }),
        h('p', { class: 'muted' }, 'Sur téléphone, appuie longuement sur l’image pour l’enregistrer.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn', href: url, download: 'equipe-' + j.nom.replace(/[^a-z0-9]+/gi, '-') + '.png' }, 'Télécharger'),
          navigator.clipboard && window.ClipboardItem ? h('button', { class: 'btn ghost', onclick: (e) => { const b = e.currentTarget; c.toBlob((blob) => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => { b.textContent = 'Copiée !'; }, () => toast('Copie impossible ici : télécharge-la.'))); } }, 'Copier l’image') : null,
          h('button', { class: 'btn ghost', onclick: fermer }, 'Fermer'))));
    document.body.append(voile);
  }

  function fin() {
    const blocs = etat.joueurs.map((j, i) => {
      const moi = i === etat.moi;
      const membres = j.equipe.map((p, s) => {
        const fam = moi ? etat.familles[s] : null;
        return h('div', { class: 'membre' }, h('img', { src: p.sprite, alt: '' }),
          fam && fam.length > 1
            ? h('div', { class: 'field' }, h('label', { for: 'forme' + s }, 'Jouer en tant que'),
              h('select', { id: 'forme' + s, onchange: (e) => emit('forme', { slot: s, id: Number(e.target.value) }) }, fam.map((f) => h('option', { value: f.id, selected: f.choisi }, f.nom))))
            : h('b', {}, p.nom),
          moi && etat.sets[s] && etat.sets[s].length ? h('span') : null,
          moi && etat.sets[s] && etat.sets[s].length
            ? h('div', { class: 'field' }, h('label', { for: 'set' + s }, 'Set Smogon'),
              h('select', { id: 'set' + s, onchange: (e) => emit('set', { slot: s, n: Number(e.target.value) }) }, etat.sets[s].map((x) => h('option', { value: x.n, selected: x.choisi }, x.label))))
            : moi ? h('span') : null,
          moi && !(etat.sets[s] && etat.sets[s].length) ? h('span', { class: 'muted' }, 'Pas de set Smogon pour ce Pokémon : à compléter dans Showdown.') : null);
      });
      const ta = h('textarea', { class: 'export', readonly: true, id: 'export' + i, 'aria-label': 'Équipe au format Showdown' });
      ta.value = etat.showdown[i] || '';
      return h('div', { class: 'panel' }, h('h2', { class: 'h2' }, 'ÉQUIPE DE ' + j.nom.toUpperCase()), membres,
        moi ? [h('div', { class: 'field' }, h('label', { for: 'export' + i }, 'Export Showdown'), ta),
          h('button', { class: 'btn ghost', onclick: (e) => copier(ta.value, e.currentTarget) }, 'Copier pour Showdown')]
          : h('p', { class: 'muted', style: 'margin:0' }, 'Ses évolutions, formes et sets restent secrets jusqu’au combat.'));
    });
    const [j0, j1] = etat.joueurs;
    const resultat = h('div', { class: 'panel resultat' },
      h('div', { class: 'res-tete' }, h('h2', { class: 'h2' }, 'APRÈS LE COMBAT'),
        h('div', { class: 'tableau', 'aria-label': 'Score entre vous' },
          h('span', {}, j0.nom), h('b', {}, etat.scores[0] + ' – ' + etat.scores[1]), h('span', {}, j1.nom))),
      h('p', { class: 'muted' }, etat.gagnant == null ? 'Qui a gagné sur Showdown ? Le score entre vous deux est gardé pour vos prochaines parties.' : etat.joueurs[etat.gagnant].nom + ' remporte le combat ! Tu peux corriger si besoin.'),
      h('div', { class: 'res-choix' }, etat.joueurs.map((j, i) => h('button', { class: 'btn' + (etat.gagnant === i ? '' : ' ghost'), 'aria-pressed': String(etat.gagnant === i), onclick: () => emit('resultat', { gagnant: i }) },
        j.avatar != null ? imgDresseur(j.avatar, 'res-av') : null, j.nom + ' a gagné'))));
    return [h('div', { class: 'fin-tete' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Partie terminée'), h('h1', { class: 'big' }, 'PLACE AU COMBAT')),
      h('button', { class: 'btn', onclick: imageEquipe }, ico('pokeball'), 'Image de mon équipe')),
      h('p', { class: 'muted', style: 'margin:0;max-width:60ch' }, 'Choisis sous quelle forme jouer chaque Pokémon (évolution ou forme alternative), copie ton équipe puis colle-la dans le Teambuilder de Pokémon Showdown (« Import from text »).'),
      h('div', { class: 'equipes' }, blocs),
      resultat,
      etat.moi === etat.hote ? h('button', { class: 'btn', style: 'align-self:center', onclick: () => emit('rejouer') }, 'Nouvelle partie') : null];
  }

  // ---------- Les commentateurs : une boîte de dialogue qui raconte la partie ----------
  const COMMENTATEURS = 74; // les « Reporters » d'Émeraude
  let com = { base: '', reveles: null, devoilees: null, texte: '' };
  function commentaire() {
    if (etat.phase !== 'round' && etat.phase !== 'revelation') return '';
    const dev = etat.joueurs[etat.devineur].nom, mai = etat.joueurs[etat.maitre].nom;
    const moiDevine = etat.moi === etat.devineur;
    const base = etat.phase + etat.round + '-' + etat.tour;
    const neuve = com.base !== base;
    if (neuve) com = { base, reveles: null, devoilees: null, texte: '' };
    if (etat.phase === 'round') {
      const rev = etat.cartes.map((c) => c.reveles);
      const i = com.reveles ? rev.findIndex((n, k) => n > com.reveles[k]) : -1;
      com.reveles = rev;
      const total = rev.reduce((x, y) => x + y, 0);
      const fini = etat.cartes.every((c) => c.reveles >= c.total);
      if (!total) com.texte = moiDevine
        ? 'Round ' + (etat.round + 1) + ', mode « ' + etat.mode.nom + ' » ! ' + mai + ' a trois Pokémon sous les yeux… et toi, rien du tout. Patience !'
        : 'Round ' + (etat.round + 1) + ', mode « ' + etat.mode.nom + ' ». Tu tiens la télécommande : dévoile les indices à ' + dev + ' quand tu veux.';
      else if (i >= 0 && fini) com.texte = moiDevine ? 'Dernier indice ! Tout est sur la table : à toi de trancher, ' + dev + '.' : 'Tout est dévoilé. ' + dev + ' doit choisir maintenant…';
      else if (i >= 0) com.texte = moiDevine ? mai + ' dévoile un indice sur le starter ' + LETTRES[i] + ' !' : 'Indice envoyé sur le starter ' + LETTRES[i] + '. ' + dev + ' cogite…';
      else if (!com.texte) com.texte = fini ? 'Tous les indices sont dévoilés. À ' + dev + ' de jouer !' : moiDevine ? mai + ' a déjà dévoilé ' + total + ' indice' + (total > 1 ? 's' : '') + '. Regarde bien !' : 'Continue de dévoiler les indices à ' + dev + '.';
    } else {
      const dv = etat.cartes.map((c) => !!c.devoilee);
      const i = com.devoilees ? dv.findIndex((v, k) => v && !com.devoilees[k]) : -1;
      com.devoilees = dv;
      const L = LETTRES[etat.choix];
      const c = etat.cartes[i];
      if (i >= 0 && c) com.texte = i === etat.choix ? 'C’était ' + c.nom + ' ! Bienvenue dans l’équipe de ' + dev + ' !' : 'Le starter ' + LETTRES[i] + ' cachait ' + c.nom + '.' + (dv.every(Boolean) ? ' Rideau !' : '');
      else if (!com.texte) com.texte = dv.some(Boolean) ? 'La révélation continue…' : moiDevine ? 'Tu recrutes le starter ' + L + ' ! ' + mai + ' va lever le rideau…' : dev + ' a choisi le starter ' + L + '. À toi de lever le rideau, dans l’ordre que tu veux.';
    }
    return com.texte;
  }
  let texteAffiche = '';
  function dialogue() {
    const t = commentaire();
    if (!t) return null;
    const p = h('p', { 'aria-live': 'polite' });
    const box = h('div', { class: 'dialogue' }, imgDresseur(COMMENTATEURS, 'dlg-img'), h('div', {}, h('b', {}, 'Les commentateurs'), p));
    if (t === texteAffiche || calme) p.textContent = t;
    else {
      texteAffiche = t;
      let n = 0;
      const tic = setInterval(() => { n += 2; p.textContent = t.slice(0, n); if (n >= t.length || !p.isConnected) clearInterval(tic); }, 18);
    }
    return box;
  }

  function bandeau() {
    const sides = etat.joueurs.map((j, ti) => {
      const k = [j.avatar != null ? imgDresseur(j.avatar, 'av-mini') : null, h('span', {}, j.nom.toUpperCase())];
      for (let i = 0; i < etat.rounds; i++) {
        const p = j.equipe[i];
        const pop = p && fresh('slot-' + ti + '-' + i + '-' + p.id);
        k.push(h('div', { class: 's' + (pop ? ' pop' : '') }, p && p.sprite ? h('img', { src: p.sprite, alt: p.nom, title: p.nom }) : p ? '?' : null));
      }
      if (ti) k.reverse();
      return h('div', { class: 'side' }, k);
    });
    return h('div', { class: 'lower' },
      h('div', { class: 'lower-in haut' }, dialogue(), h('div', { class: 'reacts' }, REACTIONS.map((t) => h('button', { onclick: () => socket.emit('reaction', { texte: t }) }, t)))),
      h('div', { class: 'lower-in' }, h('div', { class: 'live' }, 'EN DIRECT'), h('div', { class: 'score' }, sides)));
  }

  render();
})();
