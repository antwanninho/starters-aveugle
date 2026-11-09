# Starters à l'aveugle

Jeu web 1v1 inspiré de Sneaze : 6 rounds, chaque joueur reçoit à son tour 3 Pokémon mystères.
L'adversaire les voit et dévoile des indices un par un ; le joueur recrute celui qu'il pense être le meilleur.
À la fin, chacun choisit la forme ou l'évolution de ses Pokémon et exporte son équipe pour Pokémon Showdown.

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
```

## Structure

- `server.js` : serveur Express + Socket.IO (salons temps réel, proxy des médias).
- `src/game.js` : logique de partie (salons, tirages, tours, vues par joueur).
- `src/modes.js` : les modes de jeu et leurs indices. Ajouter un mode = ajouter un objet ici.
- `public/` : le site (HTML/CSS/JS sans build), design « Plateau télé ».
- `data/pokemon.json` : données générées depuis PokéAPI (noms FR, palettes shiny, Pokédex, attaques…).
- `tools/build_data.py` : régénère `data/pokemon.json` à partir des CSV PokéAPI et des sprites shiny.

Les sprites, artworks et cris sont chargés depuis les dépôts GitHub de PokéAPI.
Les cris et les zooms passent par `/m/<jeton>` pour que le devineur ne voie pas l'identifiant du Pokémon.

## Modes disponibles (V1)

1 Couleurs du shiny · 2 Cri · 3 Description Pokédex · 4 Catégorie d'espèce · 5 Taille et poids ·
6 Dernières attaques · 7 Talents · 8 Types inversés (faiblesses/résistances) · 9 Numéro de Pokédex ·
10 Méthode d'évolution · 11 Groupes d'œufs · 12 Génération et jeu · 13 Stats de base ·
14 Lieux d'apparition · 16 Zoom · 20 Caractéristique libre.

## Mise en ligne (Render, gratuit)

1. Pousser ce dossier sur un dépôt GitHub.
2. Sur render.com : New → Web Service → choisir le dépôt.
3. Build command `npm install`, start command `npm start`, plan Free.

Le plan gratuit met le serveur en veille après 15 min sans visite : le premier chargement peut prendre ~1 minute.
