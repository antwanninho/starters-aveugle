// Usage : node tools/validate_sets.js data/pokemon.json <sets_bruts.json> data/sets.json  (nécessite npm i -D pokemon-showdown)
// Garde uniquement les sets acceptés par le validateur Showdown au format gen9nationaldexag.
const fs = require('fs');
const ps = require('pokemon-showdown');
const [,, POKE, SETS, OUT] = process.argv;
const poke = JSON.parse(fs.readFileSync(POKE, 'utf8'));
const sets = JSON.parse(fs.readFileSync(SETS, 'utf8'));
const v = new ps.TeamValidator('gen9nationaldexag');
const dex = ps.Dex.mod('gen9');
const out = {};
const noms = {};
const ALIASES = [[/-Female$/, '-F'], [/-Breed$/, ''], [/-Galar-Standard$/, '-Galar'], [/-Plumage$/, ''], [/-Family-Of-Three$/, ''], [/-Own-Tempo$/, ''], [/-Mask$/, '']];
function trouve(nom) {
  let sp = dex.species.get(nom);
  for (const [a, b] of ALIASES) if (!sp.exists && a.test(nom)) sp = dex.species.get(nom.replace(a, b));
  if (sp.exists && sp.battleOnly && !sp.requiredItem && typeof sp.battleOnly === 'string') sp = dex.species.get(sp.battleOnly);
  if (sp.exists && !sp.requiredItem && Array.isArray(sp.battleOnly)) sp = dex.species.get(sp.battleOnly[0]);
  return sp;
}
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
function setDeBase(sp) {
  // Set simple généré : talent par défaut et les 4 attaques offensives les plus fortes (STAB favorisé).
  let ls = null, cur = sp;
  const moves = new Set();
  while (cur && cur.exists) {
    const l = dex.data.Learnsets[cur.id] || dex.data.Learnsets[ps.toID(cur.baseSpecies)];
    if (l && l.learnset) Object.keys(l.learnset).forEach((m) => moves.add(m));
    cur = cur.prevo ? dex.species.get(cur.prevo) : null;
  }
  const phys = sp.baseStats.atk >= sp.baseStats.spa;
  const cand = [...moves].map((m) => dex.moves.get(m)).filter((m) => m.exists && !m.isNonstandard && m.basePower >= 50 && m.basePower <= 150 && !m.flags.charge && !m.flags.recharge && !m.selfdestruct)
    .map((m) => ({ m, score: m.basePower * (sp.types.includes(m.type) ? 1.5 : 1) * ((m.category === 'Physical') === phys ? 1.3 : .7) * (m.accuracy === true ? 1 : m.accuracy / 100) }))
    .sort((a, b) => b.score - a.score);
  const pris = [], types = new Set();
  for (const c of cand) { if (pris.length >= 4) break; if (types.has(c.m.type) && pris.length < 3) continue; pris.push(c.m.name); types.add(c.m.type); }
  for (const c of cand) { if (pris.length >= 4) break; if (!pris.includes(c.m.name)) pris.push(c.m.name); }
  if (!pris.length) return null;
  return { moves: pris, ability: sp.abilities['0'], nature: phys ? 'Adamant' : 'Modest', evs: phys ? { atk: 252, spe: 252, hp: 4 } : { spa: 252, spe: 252, hp: 4 } };
}
function valide(sp, set) {
  const t = [{ species: sp.name, name: '', item: set.item || '', ability: set.ability || sp.abilities['0'], moves: set.moves || [], nature: set.nature || 'Serious',
    evs: Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, set.evs || {}),
    ivs: Object.assign({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, set.ivs || {}),
    level: set.level || 100, teraType: set.tera || undefined, gender: '' }];
  return v.validateTeam(t);
}
let ok = 0, ko = 0, sansSet = [], inconnu = [];
const raisons = {};
for (const p of poke) {
  const espece = p.cat === 'mega' ? p.showdown.replace(/-(Mega(-[XYZ])?|Primal)$/, '') : p.showdown;
  const sp = trouve(espece);
  if (!sp.exists) { inconnu.push(espece); continue; }
  noms[p.id] = sp.name;
  const garde = [];
  for (const s of sets[p.id] || []) {
    const set = s.set;
    const ability = set.ability || sp.abilities['0'];
    const err = valide(sp, set);
    if (err) { ko++; const r = err[0].replace(/^.*?\) /, '').slice(0, 60); raisons[r] = (raisons[r] || 0) + 1; continue; }
    ok++;
    garde.push({ label: s.label, set: Object.assign({}, set, { ability, espece: sp.name }) });
  }
  if (!garde.length && p.cat !== 'mega') {
    const b = setDeBase(sp);
    if (b && !valide(sp, b)) garde.push({ label: 'Set de base (généré, pas de set Smogon)', set: b });
  }
  if (garde.length) out[p.id] = garde; else sansSet.push(p.showdown);
}
fs.writeFileSync(OUT, JSON.stringify({ noms, sets: out }));
console.log('sets valides', ok, 'refusés', ko, '| Pokémon avec set', Object.keys(out).length, 'sans set', sansSet.length, 'espèce inconnue', inconnu.length);
console.log('inconnus', inconnu.join(', ')); console.log('sans set', sansSet.join(', '));
console.log(Object.entries(raisons).sort((a, b) => b[1] - a[1]).slice(0, 12));
