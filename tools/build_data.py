"""Construit public/data/pokemon.json à partir des CSV PokéAPI et des sprites shiny.

Usage : python3 -I tools/build_data.py <dossier_csv> <dossier_sprites_shiny> <sortie.json>
Les CSV viennent de https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
Les sprites shiny de https://github.com/PokeAPI/sprites (sprites/pokemon/shiny/{id}.png)
"""
import csv, json, os, re, sys
from collections import defaultdict
from PIL import Image

CSV, SHINY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FR, EN = '5', '9'


def rows(name):
    with open(os.path.join(CSV, name + '.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def names(name, key, lang=FR, col='name'):
    return {r[key]: r[col] for r in rows(name) if r['local_language_id'] == lang}


# ---------- tables ----------
pokemon = rows('pokemon')
species = {r['id']: r for r in rows('pokemon_species')}
sp_rows = rows('pokemon_species_names')
sp_fr = {r['pokemon_species_id']: r for r in sp_rows if r['local_language_id'] == FR}
sp_en = {r['pokemon_species_id']: r['name'] for r in sp_rows if r['local_language_id'] == EN}
forms = rows('pokemon_forms')
form_by_poke = {}
for f in forms:
    if f['is_default'] == '1':
        form_by_poke[f['pokemon_id']] = f
form_names_fr = {}
for r in rows('pokemon_form_names'):
    if r['local_language_id'] == FR:
        form_names_fr[r['pokemon_form_id']] = r
type_fr = names('type_names', 'type_id')
ability_fr = names('ability_names', 'ability_id')
move_fr = names('move_names', 'move_id')
item_fr = names('item_names', 'item_id')
egg_fr = names('egg_group_prose', 'egg_group_id')
trigger_fr = names('evolution_trigger_prose', 'evolution_trigger_id')
gen_fr = names('generation_names', 'generation_id')
version_fr = names('version_names', 'version_id')
loc_fr = names('location_names', 'location_id')
vg_order = {r['id']: int(r['order']) for r in rows('version_groups')}
vg_versions = defaultdict(list)
version_vg = {}
for r in rows('versions'):
    vg_versions[r['version_group_id']].append(r['id'])
    version_vg[r['id']] = r['version_group_id']

types = defaultdict(list)
for r in sorted(rows('pokemon_types'), key=lambda r: int(r['slot'])):
    types[r['pokemon_id']].append(type_fr.get(r['type_id'], '?'))
stats = defaultdict(dict)
STAT = {'1': 'pv', '2': 'atk', '3': 'def', '4': 'spa', '5': 'spd', '6': 'spe'}
for r in rows('pokemon_stats'):
    stats[r['pokemon_id']][STAT[r['stat_id']]] = int(r['base_stat'])
abilities = defaultdict(list)
for r in sorted(rows('pokemon_abilities'), key=lambda r: int(r['slot'])):
    abilities[r['pokemon_id']].append({'nom': ability_fr.get(r['ability_id'], '?'), 'cache': r['is_hidden'] == '1'})
eggs = defaultdict(list)
for r in rows('pokemon_egg_groups'):
    eggs[r['species_id']].append(egg_fr.get(r['egg_group_id'], '?'))

# dernières attaques apprises par niveau, dans la version la plus récente disponible
lvl_moves = defaultdict(lambda: defaultdict(list))
for r in rows('pokemon_moves'):
    if r['pokemon_move_method_id'] == '1':
        lvl_moves[r['pokemon_id']][r['version_group_id']].append((int(r['level'] or 0), r['move_id']))


def last_moves(pid):
    vgs = lvl_moves.get(pid)
    if not vgs:
        return None
    vg = max(vgs, key=lambda v: vg_order.get(v, 0))
    seen, out = set(), []
    for lvl, mid in sorted(vgs[vg], reverse=True):
        n = move_fr.get(mid)
        if n and n not in seen:
            seen.add(n)
            out.append({'nom': n, 'niveau': lvl})
        if len(out) == 4:
            break
    return out


# flavor text FR le plus récent
flavor, flavor_en = {}, {}
for r in rows('pokemon_species_flavor_text'):
    target = flavor if r['language_id'] == FR else flavor_en if r['language_id'] == EN else None
    if target is None:
        continue
    v = int(r['version_id'])
    if r['species_id'] not in target or v > target[r['species_id']][0]:
        target[r['species_id']] = (v, ' '.join(r['flavor_text'].split()))

# évolutions
evo_rows = defaultdict(list)
for r in rows('pokemon_evolution'):
    evo_rows[r['evolved_species_id']].append(r)
children = defaultdict(list)
for sid, s in species.items():
    if s['evolves_from_species_id']:
        children[s['evolves_from_species_id']].append(sid)
TIME = {'day': 'de jour', 'night': 'de nuit', 'dusk': 'au crépuscule'}


def describe_evo(r):
    t = r['evolution_trigger_id']
    parts = []
    if t == '1':
        parts.append('Niveau ' + r['minimum_level'] if r['minimum_level'] else 'Montée de niveau')
    elif t == '2':
        parts.append('Échange')
    elif t == '3':
        parts.append(item_fr.get(r['trigger_item_id'], 'Objet'))
    else:
        parts.append(trigger_fr.get(t, 'Méthode spéciale'))
    if r['minimum_happiness']:
        parts.append('bonheur')
    if r['minimum_affection']:
        parts.append('affection')
    if r['held_item_id']:
        parts.append('en tenant ' + item_fr.get(r['held_item_id'], 'un objet'))
    if r['time_of_day'] in TIME:
        parts.append(TIME[r['time_of_day']])
    if r['known_move_id']:
        parts.append('en connaissant ' + move_fr.get(r['known_move_id'], 'une capacité'))
    if r['known_move_type_id']:
        parts.append('avec une capacité ' + type_fr.get(r['known_move_type_id'], ''))
    if r['location_id']:
        parts.append('à ' + loc_fr.get(r['location_id'], 'un lieu précis'))
    if r['gender_id'] == '1':
        parts.append('femelle')
    elif r['gender_id'] == '2':
        parts.append('mâle')
    if r['trade_species_id']:
        parts.append('contre un Pokémon précis')
    if r['needs_overworld_rain'] == '1':
        parts.append('sous la pluie')
    if r['turn_upside_down'] == '1':
        parts.append('console à l’envers')
    return ', '.join(parts)


def evo_methods(sid):
    seen, out = set(), []
    for r in evo_rows.get(sid, []):
        d = describe_evo(r)
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def stage(sid):
    n = 1
    while species[sid]['evolves_from_species_id']:
        sid = species[sid]['evolves_from_species_id']
        n += 1
    return n


# lieux de rencontre : le ou les deux lieux les plus emblématiques, dans le premier jeu où on le trouve.
# Un lieu est emblématique quand le Pokémon y pèse lourd (part de la rareté des rencontres du lieu) ;
# les dons, œufs, rencontres fixes et échanges comptent comme 100 %.
areas = {r['id']: r['location_id'] for r in rows('location_areas')}
slots = {r['id']: (r['encounter_method_id'], int(r['rarity'] or 0)) for r in rows('encounter_slots')}
SPECIAL = {'18', '19', '20', '36'}
enc_part = defaultdict(lambda: defaultdict(float))
enc_tot = defaultdict(float)
enc_special = defaultdict(set)
for r in rows('encounters'):
    loc = areas.get(r['location_area_id'])
    if not loc or loc not in loc_fr:
        continue
    m, rar = slots.get(r['encounter_slot_id'], ('1', 0))
    k = (r['version_id'], loc)
    if m in SPECIAL:
        enc_special[r['pokemon_id']].add(k)
        continue
    enc_part[r['pokemon_id']][k] += rar
    enc_tot[k] += rar


def locations(pid):
    cand = defaultdict(lambda: [0.0, set()])
    for (v, loc), rar in enc_part.get(pid, {}).items():
        c = cand[(version_vg[v], loc)]
        c[0] = max(c[0], rar / enc_tot[(v, loc)] if enc_tot[(v, loc)] else 0)
        c[1].add(v)
    for v, loc in enc_special.get(pid, ()):
        c = cand[(version_vg[v], loc)]
        c[0] = 1.0
        c[1].add(v)
    if not cand:
        return None
    vg = min({g for g, _ in cand}, key=lambda g: vg_order.get(g, 0))
    best = sorted(((s, loc, vs) for (g, loc), (s, vs) in cand.items() if g == vg), key=lambda x: -x[0])
    top = [best[0]] + [b for b in best[1:2] if b[0] >= .5 * best[0][0]]
    vs = sorted(set().union(*[b[2] for b in top]), key=int)
    return {'jeu': ' / '.join(version_fr.get(v, '?') for v in vs), 'lieux': [loc_fr[b[1]] for b in top]}


# version d'apparition (forme par défaut du Pokémon)
def intro_game(pid):
    f = form_by_poke.get(pid)
    if not f:
        return None
    vs = vg_versions.get(f['introduced_in_version_group_id'], [])
    return ' / '.join(version_fr.get(v, '?') for v in vs[:2]) or None


# palette shiny
def palette(pid, k=5):
    path = os.path.join(SHINY, pid + '.png')
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert('RGBA')
    px = [p[:3] for p in im.get_flattened_data() if p[3] > 200] if hasattr(im, 'get_flattened_data') else [p[:3] for p in im.getdata() if p[3] > 200]
    px = [p for p in px if sum(p) > 60] or px  # retire le contour noir
    if not px:
        return None
    q = Image.new('RGB', (len(px), 1))
    q.putdata(px)
    q = q.quantize(k, method=Image.Quantize.MEDIANCUT)
    cols = q.getpalette()[:k * 3]
    cnt = q.getcolors()
    tot = sum(c for c, _ in cnt)
    out = sorted(((c / tot, '#%02x%02x%02x' % tuple(cols[j * 3:j * 3 + 3])) for c, j in cnt), reverse=True)
    out = [[round(a * 100), h] for a, h in out if a >= 0.03]
    return out


EXCLUDE = re.compile(r'(-totem|-cap$|-cap-|-starter$|-rock-star|-belle|-pop-star|-phd|-libre|-cosplay|power-construct|battle-bond|-meteor$|^minior-(red|orange|yellow|green|blue|indigo|violet)$|-eternamax|-gmax)')


def category(p):
    ident = p['identifier']
    if p['is_default'] == '1':
        return 'base'
    if '-mega' in ident or '-primal' in ident:
        return 'mega'
    return 'forme'


def showdown_name(p):
    sid = p['species_id']
    base = sp_en.get(sid, p['identifier'].title())
    if p['is_default'] == '1':
        return base
    suffix = p['identifier'][len(species[sid]['identifier']):].strip('-')
    return base + '-' + '-'.join(w.capitalize() for w in suffix.split('-')) if suffix else base


def fr_name(p):
    sid = p['species_id']
    base = sp_fr.get(sid, {}).get('name', p['identifier'])
    if p['is_default'] == '1':
        return base
    f = form_by_poke.get(p['id'])
    fn = form_names_fr.get(f['id']) if f else None
    if fn and fn['pokemon_name']:
        return fn['pokemon_name']
    if fn and fn['form_name']:
        return base + ' (' + fn['form_name'] + ')'
    return base + ' (' + p['identifier'][len(species[sid]['identifier']):].strip('-') + ')'


def hide_name(text, sid):
    for n in (sp_fr.get(sid, {}).get('name'), sp_en.get(sid)):
        if n:
            text = re.sub(re.escape(n), '???', text, flags=re.I)
    return text


out = []
missing_pal = 0
for p in pokemon:
    pid, sid = p['id'], p['species_id']
    if EXCLUDE.search(p['identifier']):
        continue
    pal = palette(pid)
    if not pal:
        missing_pal += 1
        continue
    s = species[sid]
    base_pid = next((q['id'] for q in pokemon if q['species_id'] == sid and q['is_default'] == '1'), pid)
    moves = last_moves(pid) or last_moves(base_pid) or []
    fl = flavor.get(sid)
    fl_lang = 'fr'
    if not fl and sid in flavor_en:
        fl, fl_lang = flavor_en[sid], 'en'
    prev = s['evolves_from_species_id']
    out.append({
        'id': int(pid),
        'espece': int(sid),
        'nom': fr_name(p),
        'nomEspece': sp_fr.get(sid, {}).get('name', ''),
        'showdown': showdown_name(p),
        'cat': category(p),
        'legendaire': s['is_legendary'] == '1' or s['is_mythical'] == '1',
        'bebe': s['is_baby'] == '1',
        'gen': int(s['generation_id']),
        'genNom': gen_fr.get(s['generation_id'], ''),
        'jeu': intro_game(pid),
        'types': types[pid],
        'taille': int(p['height']) / 10,
        'poids': int(p['weight']) / 10,
        'categorie': sp_fr.get(sid, {}).get('genus', ''),
        'pokedex': hide_name(fl[1], sid) if fl else None,
        'pokedexLangue': fl_lang if fl else None,
        'talents': abilities[pid],
        'attaques': moves,
        'oeufs': eggs.get(sid, []),
        'stats': stats[pid],
        'stade': stage(sid),
        'chaine': int(s['evolution_chain_id'] or 0),
        'evolueDe': {'nom': sp_fr.get(prev, {}).get('name', ''), 'methodes': evo_methods(sid)} if prev else None,
        'evolueEn': [{'methodes': evo_methods(c)} for c in children.get(sid, [])],
        'lieux': locations(pid),
        'palette': pal,
    })

out.sort(key=lambda e: e['id'])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(len(out), 'Pokémon écrits ;', missing_pal, 'sans sprite shiny ignorés')
