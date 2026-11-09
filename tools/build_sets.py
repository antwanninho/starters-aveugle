"""Construit data/sets.json : les sets Smogon de chaque Pokémon, prêts à exporter vers Showdown.

Usage : python3 -I tools/build_sets.py <dossier_sets> data/pokemon.json <sets_bruts.json>, puis tools/validate_sets.js
Les fichiers genN.json viennent de https://github.com/pkmn/smogon (data/sets/genN.json).
"""
import json, re, sys

SETS_DIR, POKE, OUT = sys.argv[1:4]
tid = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())

PRIORITY = ['ou', 'ubers', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nationaldex', 'nationaldexubers', 'nationaldexuu',
            'nationaldexru', 'monotype', 'nationaldexmonotype', 'doublesou', 'vgc2025', 'vgc2024', 'battlestadiumsingles', '1v1']
LABEL = {'ou': 'OU', 'ubers': 'Ubers', 'uu': 'UU', 'ru': 'RU', 'nu': 'NU', 'pu': 'PU', 'zu': 'ZU', 'lc': 'LC',
         'nationaldex': 'National Dex', 'nationaldexubers': 'National Dex Ubers', 'nationaldexuu': 'National Dex UU',
         'nationaldexru': 'National Dex RU', 'monotype': 'Monotype', 'nationaldexmonotype': 'National Dex Monotype',
         'doublesou': 'Doubles OU', 'vgc2025': 'VGC 2025', 'vgc2024': 'VGC 2024', 'battlestadiumsingles': 'BSS', '1v1': '1v1'}
MAX = 8

gens = {g: json.load(open(f'{SETS_DIR}/gen{g}.json')) for g in (9, 8, 7, 6)}


def first(x):
    return x[0] if isinstance(x, list) and x else x


def normalize(s, gen, fmt):
    out = {
        'moves': [first(m) for m in s.get('moves', [])][:4],
        'item': first(s.get('item')),
        'ability': first(s.get('ability')),
        'nature': first(s.get('nature')),
        'evs': first(s.get('evs')),
        'ivs': first(s.get('ivs')),
    }
    if gen == 9 and s.get('teratypes'):
        out['tera'] = first(s['teratypes'])
    if fmt == 'lc':
        out['level'] = 5
    return {k: v for k, v in out.items() if v}


def sets_for(name, gen):
    data = gens[gen].get(name)
    if not data:
        return []
    fmts = sorted(data, key=lambda f: PRIORITY.index(f) if f in PRIORITY else 99)
    res = []
    for f in fmts:
        for setname, s in data[f].items():
            lab = LABEL.get(f, f)
            res.append({'label': f'{lab}{"" if gen == 9 else f" (Gen {gen})"} · {setname}', 'gen': gen, 'set': normalize(s, gen, f)})
    return res


ALIASES = [(r'-Mask$', ''), (r'-Breed$', ''), (r'-Galar-Standard$', '-Galar'), (r'-Female$', '-F'), (r'-Plumage$', ''),
           (r'-Family-Of-Three$', ''), (r'-Three-Segment$', '-Three-Segment'), (r'-Own-Tempo$', '')]

index = {}
for g, d in gens.items():
    for k in d:
        index.setdefault(tid(k), k)

out = {}
stats = [0, 0]
for p in json.load(open(POKE)):
    name = p['showdown']
    mega = re.match(r'^(.*)-(Mega(?:-[XYZ])?|Primal)$', name)
    candidates = [name] + [re.sub(a, b, name) for a, b in ALIASES if re.search(a, name)]
    found = []
    if mega:
        base, kind = mega.group(1), mega.group(2)
        key = index.get(tid(base))
        for g in (9, 8, 7, 6):
            if key:
                for s in sets_for(key, g):
                    item = (s['set'].get('item') or '')
                    suffix = kind.split('-')[1] if '-' in kind else None
                    if kind == 'Primal' and item in ('Red Orb', 'Blue Orb') or kind != 'Primal' and item.endswith('ite' + (' ' + suffix if suffix else '')):
                        found.append(s)
            if found:
                break
    else:
        for c in candidates:
            key = index.get(tid(c))
            if not key:
                continue
            for g in (9, 8, 7, 6):
                found = sets_for(key, g)
                if found:
                    break
            if found:
                break
    stats[bool(found)] += 1
    if found:
        out[str(p['id'])] = found[:MAX]

json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('avec sets :', stats[1], '· sans set :', stats[0])
