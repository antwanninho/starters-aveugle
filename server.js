const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Data, Lobby, media } = require('./src/game');

const data = new Data(require('./data/pokemon.json'), require('./data/sets.json'));
const lobby = new Lobby(data);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', true); // derrière l'hébergeur (https)

// Page d'accueil avec un aperçu de lien (Discord, WhatsApp…) : titre, texte et image.
const fs = require('fs');
const pageAccueil = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const echappe = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get(['/', '/index.html'], (req, res) => {
  const origine = req.protocol + '://' + req.get('host');
  const code = String(req.query.salon || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const r = code ? lobby.get(code) : null;
  const hote = r && r.players[0] ? r.players[0].nom : null;
  const titre = code ? (hote ? hote + ' t’invite à jouer' : 'Invitation au salon ' + code) + ' · Starters à l’aveugle' : 'Starters à l’aveugle';
  const texte = code ? 'Code du salon : ' + code + '. Ton adversaire voit trois Pokémon, toi seulement ses indices. Clique pour entrer sur le plateau.' : 'Jeu 1v1 : ton adversaire voit trois Pokémon, toi seulement ses indices. Recrute ton équipe, puis affrontez-vous sur Showdown.';
  const tags = [
    ['og:type', 'website'], ['og:site_name', 'Starters à l’aveugle'], ['og:title', titre], ['og:description', texte],
    ['og:image', origine + '/img/apercu.png'], ['og:image:width', '1200'], ['og:image:height', '630'], ['og:url', origine + req.originalUrl],
  ].map(([p, c]) => '<meta property="' + p + '" content="' + echappe(c) + '">').join('\n')
    + '\n<meta name="twitter:card" content="summary_large_image">\n<meta name="theme-color" content="#ffcc33">';
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(pageAccueil.replace('<!--apercu-->', tags));
});

app.use(express.static(path.join(__dirname, 'public')));

// Médias (cris, artworks) servis via un jeton opaque pour ne pas révéler le Pokémon.
const cache = new Map();
app.get('/m/:t', async (req, res) => {
  const m = media.get(req.params.t);
  if (!m) return res.status(404).end();
  try {
    let hit = cache.get(m.url);
    if (!hit) {
      const r = await fetch(m.url);
      if (!r.ok) return res.status(502).end();
      hit = { type: r.headers.get('content-type') || 'application/octet-stream', buf: Buffer.from(await r.arrayBuffer()) };
      if (cache.size > 400) cache.delete(cache.keys().next().value);
      cache.set(m.url, hit);
    }
    res.set('Content-Type', m.url.endsWith('.ogg') ? 'audio/ogg' : hit.type);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(hit.buf);
  } catch (e) {
    res.status(502).end();
  }
});

app.get('/sante', (req, res) => res.json({ ok: true, salons: lobby.rooms.size, pokemon: data.list.length }));

function broadcast(room) {
  room.touched = Date.now();
  room.players.forEach((pl, i) => {
    if (pl.socketId) io.to(pl.socketId).emit('etat', room.view(i));
  });
}

io.on('connection', (socket) => {
  let room = null;
  let idx = -1;

  const attach = (r, token) => {
    room = r;
    idx = r.indexOf(token);
    const pl = r.players[idx];
    pl.socketId = socket.id;
    pl.connecte = true;
    socket.emit('session', { code: r.code, token });
    broadcast(r);
  };

  socket.on('creer', ({ nom, avatar, stats } = {}, ack) => {
    const r = lobby.create();
    const token = r.addPlayer(nom, avatar, stats);
    attach(r, token);
    ack && ack({ ok: true });
  });

  socket.on('rejoindre', ({ code, nom, token, avatar, stats } = {}, ack) => {
    const r = lobby.get(code);
    if (!r) return ack && ack({ erreur: 'Ce salon n’existe pas (ou plus). Vérifie le code.' });
    if (token && r.indexOf(token) >= 0) {
      attach(r, token);
      return ack && ack({ ok: true });
    }
    const t = r.addPlayer(nom, avatar, stats);
    if (!t) return ack && ack({ erreur: 'Ce salon est complet : il y a déjà deux joueurs.' });
    attach(r, t);
    ack && ack({ ok: true });
  });

  const action = (fn) => (payload = {}, ack) => {
    if (!room || idx < 0) return ack && ack({ erreur: 'Rejoins d’abord un salon.' });
    const err = fn(payload);
    if (err) return ack && ack({ erreur: err });
    broadcast(room);
    ack && ack({ ok: true });
  };

  socket.on('reglages', action((p) => room.setReglages(idx, p)));
  socket.on('lancer', action(() => room.lancer(idx)));
  socket.on('avatar', action((p) => room.setAvatar(idx, p.id)));
  socket.on('stats', action((p) => room.setStats(idx, p)));
  socket.on('resultat', action((p) => room.resultat(idx, p.gagnant)));
  socket.on('devoiler', action((p) => room.devoiler(idx, Number(p.carte))));
  socket.on('indiceLibre', action((p) => room.indiceLibre(idx, Number(p.carte), p.texte)));
  socket.on('recruter', action((p) => room.recruter(idx, Number(p.carte))));
  socket.on('reveler', action((p) => room.revelerCarte(idx, Number(p.carte))));
  socket.on('continuer', action(() => room.continuer()));
  socket.on('forme', action((p) => room.choisirForme(idx, Number(p.slot), Number(p.id))));
  socket.on('set', action((p) => room.choisirSet(idx, Number(p.slot), Number(p.n))));
  socket.on('rejouer', action(() => room.rejouer(idx)));

  socket.on('reaction', ({ texte } = {}) => {
    if (!room || idx < 0) return;
    const t = String(texte || '').slice(0, 60);
    if (!t) return;
    room.players.forEach((pl) => pl.socketId && io.to(pl.socketId).emit('reaction', { de: idx, texte: t }));
  });

  socket.on('disconnect', () => {
    if (!room || idx < 0) return;
    const pl = room.players[idx];
    if (pl && pl.socketId === socket.id) {
      pl.socketId = null;
      pl.connecte = false;
      broadcast(room);
    }
  });
});

setInterval(() => lobby.cleanup(), 10 * 60e3).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Starters à l'aveugle sur http://localhost:${PORT} (${data.list.length} Pokémon)`));
