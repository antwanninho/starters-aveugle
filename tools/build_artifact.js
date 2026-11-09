// Construit une version « test sur un seul écran » du jeu, publiable comme Artifact Claude.
// Les deux joueurs sont sur le même appareil : un sélecteur bascule entre leurs deux écrans.
// Usage : node tools/build_artifact.js  ->  dist/artifact/index.html (+ data/*.json, sprites.webp, atlas.json)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist/artifact');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

fs.mkdirSync(path.join(out, 'data'), { recursive: true });
fs.copyFileSync(path.join(root, 'data/pokemon.json'), path.join(out, 'data/pokemon.json'));
fs.copyFileSync(path.join(root, 'data/sets.json'), path.join(out, 'data/sets.json'));
fs.mkdirSync(path.join(out, 'img'), { recursive: true });
for (const f of ['dresseurs.png', 'marcheurs.png']) fs.copyFileSync(path.join(root, 'public/img', f), path.join(out, 'img', f));

// Modules CommonJS du serveur, emballés pour le navigateur.
const wrap = (name, src) => `__def(${JSON.stringify(name)}, function (module, exports, require) {\n${src}\n});`;
const modules = [wrap('./modes', read('src/modes.js')), wrap('./game', read('src/game.js'))].join('\n');

const runtime = `
window.__spritesAsync = true; // les sprites du décor viennent de l'atlas, chargé un peu après la page
window.__sansCri = true;
window.__ecranPartage = true; // les deux joueurs sur le même appareil : la carte dresseur ne compte que le joueur 1
const __mods = {}, __cache = {};
function __def(name, fn) { __mods[name] = fn; }
function __req(name) {
  if (name === 'crypto') return __crypto;
  if (__cache[name]) return __cache[name].exports;
  const m = { exports: {} }; __cache[name] = m;
  __mods[name](m, m.exports, __req);
  return m.exports;
}
const __crypto = {
  randomInt(n) { return Math.floor(Math.random() * n); },
  randomBytes(n) { let s = ''; const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; for (let i = 0; i < n * 1.4; i++) s += A[Math.floor(Math.random() * A.length)]; return { toString: () => s }; },
};
${modules}

// ---------- Faux socket : la partie tourne dans la page, deux joueurs sur le même écran ----------
window.io = function () {
  const handlers = {};
  const fire = (ev, data) => handlers[ev] && handlers[ev](data);
  const game = __req('./game');
  const modes = __req('./modes');
  const cri = modes.MODES.findIndex((m) => m.id === 'cri');
  if (cri >= 0) modes.MODES.splice(cri, 1); // les cris ne peuvent pas être chargés dans Claude
  let room = null, viewer = 0, atlas = null, img = null, imgShiny = null;
  const spriteCache = new Map();
  function sprite(id, shiny) {
    const key = (shiny ? 's' : 'n') + id;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const i = atlas.index[id];
    let url = '';
    if (i != null) {
      const c = document.createElement('canvas'); c.width = c.height = atlas.size;
      c.getContext('2d').drawImage(shiny ? imgShiny : img, (i % atlas.cols) * atlas.size, Math.floor(i / atlas.cols) * atlas.size, atlas.size, atlas.size, 0, 0, atlas.size, atlas.size);
      url = c.toDataURL();
    }
    spriteCache.set(key, url);
    return url;
  }
  function resolve(view) {
    let s = JSON.stringify(view);
    s = s.replace(/https:\\/\\/raw\\.githubusercontent\\.com\\/PokeAPI\\/sprites\\/master\\/sprites\\/pokemon\\/shiny\\/(\\d+)\\.png/g, (m, id) => sprite(Number(id), true));
    s = s.replace(/https:\\/\\/raw\\.githubusercontent\\.com\\/PokeAPI\\/sprites\\/master\\/sprites\\/pokemon\\/(\\d+)\\.png/g, (m, id) => sprite(Number(id)));
    s = s.replace(/\\/m\\/([A-Za-z0-9]+)/g, (m, t) => {
      const e = game.media.get(t); const k = e && e.url.match(/\\/(\\d+)\\.png$/);
      return k ? sprite(Number(k[1])) : '';
    });
    return JSON.parse(s);
  }
  function push() {
    if (!room) return;
    fire('etat', resolve(room.view(viewer)));
    renderSwitch();
  }
  function renderSwitch() {
    let bar = document.getElementById('ecran');
    if (!room) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'ecran'; document.body.append(bar); }
    bar.replaceChildren();
    const lab = document.createElement('span'); lab.textContent = 'Écran de'; bar.append(lab);
    room.players.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.nom; b.className = i === viewer ? 'on' : '';
      b.onclick = () => { viewer = i; push(); window.scrollTo(0, 0); };
      bar.append(b);
    });
  }
  const ready = Promise.all([
    fetch('data/pokemon.json').then((r) => r.json()),
    fetch('data/sets.json').then((r) => r.json()),
    fetch('atlas.json').then((r) => r.json()),
    new Promise((ok, ko) => { img = new Image(); img.onload = ok; img.onerror = ko; img.src = 'sprites.webp'; }),
    new Promise((ok, ko) => { imgShiny = new Image(); imgShiny.onload = ok; imgShiny.onerror = ko; imgShiny.src = 'sprites-shiny.webp'; }),
  ]).then(([list, sets, a]) => {
    atlas = a;
    window.__sprite = (id) => sprite(id);
    window.dispatchEvent(new Event('sprites'));
    return new game.Lobby(new game.Data(list, sets));
  });

  const actions = {
    creer(p) { return ready.then((lobby) => { room = lobby.create(); room.addPlayer(p.nom, p.avatar, p.stats); room.addPlayer('Joueur 2', 3); viewer = 0; return null; }); },
    rejoindre() { return Promise.resolve('Dans la version test, les deux joueurs sont sur le même écran : crée un salon.'); },
    reglages: (p) => room.setReglages(viewer, p),
    lancer: () => room.lancer(viewer),
    avatar: (p) => room.setAvatar(viewer, p.id),
    stats: (p) => room.setStats(viewer, p),
    resultat: (p) => room.resultat(viewer, p.gagnant),
    devoiler: (p) => room.devoiler(viewer, Number(p.carte)),
    indiceLibre: (p) => room.indiceLibre(viewer, Number(p.carte), p.texte),
    recruter: (p) => room.recruter(viewer, Number(p.carte)),
    reveler: (p) => room.revelerCarte(viewer, Number(p.carte)),
    continuer: () => room.continuer(),
    forme: (p) => room.choisirForme(viewer, Number(p.slot), Number(p.id)),
    set: (p) => room.choisirSet(viewer, Number(p.slot), Number(p.n)),
    rejouer: () => room.rejouer(viewer),
  };
  const socket = {
    on(ev, fn) { handlers[ev] = fn; if (ev === 'connect') setTimeout(fn, 0); },
    emit(ev, payload, ack) {
      if (ev === 'reaction') { fire('reaction', { de: viewer, texte: payload.texte }); return; }
      const fn = actions[ev];
      if (!fn) return;
      Promise.resolve(fn(payload || {})).then((err) => {
        if (err) { ack && ack({ erreur: err }); return; }
        push(); ack && ack({ ok: true });
      }).catch((e) => ack && ack({ erreur: 'Chargement impossible : ' + e.message }));
    },
  };
  return socket;
};
`;

const css = read('public/style.css') + `
#ecran { position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); z-index: 8; display: flex; align-items: center; gap: 6px; background: var(--craie); color: var(--nuit); padding: 6px; border-radius: 999px; box-shadow: 0 10px 24px rgba(0,0,0,.4); font: 700 13px var(--texte) }
#ecran span { padding: 0 6px 0 10px; letter-spacing: .1em; text-transform: uppercase }
#ecran button { min-height: 36px; border: 0; border-radius: 999px; padding: 0 14px; background: transparent; font-weight: 700; color: var(--nuit) }
#ecran button.on { background: var(--nuit); color: var(--craie) }
.zoom { image-rendering: pixelated }
#app { padding-top: 70px }
`;

const app = read('public/app.js');
const html = `<meta charset="utf-8">
<title>Starters à l'aveugle</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@500;600;700&display=swap">
<style>
${css}
</style>
<div class="beams" aria-hidden="true"><i></i><i></i><i></i></div>
<main id="app"></main>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script>
${runtime}
</script>
<script>
${app}
</script>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('dist/artifact/index.html', (html.length / 1024).toFixed(0) + ' Ko');
