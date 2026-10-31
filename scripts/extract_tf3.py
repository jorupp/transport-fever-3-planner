"""Extract a portable TF3 catalog. Python standard library only; never execute game Lua.

Usage: python scripts/extract_tf3.py --game-dir "C:\\...\\Transport Fever 3"
"""
import argparse
import ast
import datetime
import gettext
import hashlib
import json
import math
import pathlib
import re
import zipfile

DEFAULT_GAME = r"C:\Program Files (x86)\Steam\steamapps\common\Transport Fever 3"
TOKEN = re.compile(r'\s+|--\[\[.*?\]\]|--[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|.', re.S)


class LuaLiteral:
    """Deliberately small, strict reader for literal tables and numeric arithmetic."""
    def __init__(self, text):
        self.tokens = [t for t in TOKEN.findall(text) if not t.isspace() and not t.startswith('--')]
        self.i = 0

    def take(self, expected=None):
        t = self.tokens[self.i]
        self.i += 1
        if expected is not None and t != expected:
            raise ValueError(f'Expected {expected}, got {t} near {self.tokens[self.i:self.i+8]}')
        return t

    def value(self):
        t = self.take()
        if t == '{':
            array, obj = [], {}
            while self.tokens[self.i] != '}':
                if self.tokens[self.i] == '[':
                    self.take('['); key = self.value(); self.take(']'); self.take('=')
                    obj[key] = self.value()
                elif self.i + 1 < len(self.tokens) and self.tokens[self.i+1] == '=':
                    key = self.take(); self.take('='); obj[key] = self.value()
                else:
                    array.append(self.value())
                if self.tokens[self.i] in [',', ';']:
                    self.take()
            self.take('}')
            if obj and array:
                raise ValueError('Mixed-key tables are unsupported')
            return obj if obj else array
        if t in ['_', 'N_']:
            self.take('('); result = self.value(); self.take(')'); return result
        if t[0] in ['"', "'"]:
            # Lua game strings here use the JSON/Python common escape subset.
            return ast.literal_eval(t)
        if t in ['true', 'false', 'nil']:
            return {'true': True, 'false': False, 'nil': None}[t]
        sign = 1
        if t == '-':
            sign = -1; t = self.take()
        try:
            result = sign * float(t)
        except ValueError:
            raise ValueError(f'Unsupported Lua expression: {t}') from None
        if self.i < len(self.tokens) and self.tokens[self.i] == '/':
            self.take('/'); result /= self.value()
        return int(result) if result == int(result) else result


def table(text, marker):
    start = text.index(marker) + len(marker)
    return LuaLiteral(text[start:]).value()


def arr(value):
    return value if isinstance(value, list) else []


def obj(value):
    return value if isinstance(value, dict) else {}


def round_game(x):
    return math.floor(x + 0.5)


def capacity_by_cargo(tv, cargos):
    result = {}
    for cargo in cargos:
        total = 0
        for compartment in arr(tv.get('compartments', tv.get('compartmentsList', []))):
            capacities = []
            for config in arr(compartment.get('loadConfigs')):
                entry = obj(config.get('cargoEntry'))
                rule = obj(entry.get('cargoTypeSet'))
                included = cargo['id'] in arr(rule.get('cargoTypesIncluded')) or bool(set(cargo['classes']) & set(arr(rule.get('cargoClassesIncluded'))))
                excluded = cargo['id'] in arr(rule.get('cargoTypesExcluded')) or bool(set(cargo['classes']) & set(arr(rule.get('cargoClassesExcluded'))))
                if included and not excluded:
                    capacities.append(entry.get('capacity', 0))
            total += max(capacities, default=0)
        if total > 0:
            result[cargo['id']] = total / 4
    return result


def normalize(meta, source, cargos, translate, models):
    tv = obj(meta.get('transportVehicle')); lv = obj(meta.get('landVehicle'))
    if not tv or not lv or tv.get('carrier') not in ['RAIL', 'TRAM', 'ROAD']:
        return None
    extent = obj(meta.get('extent'))
    if not extent.get('bbMax') or not extent.get('bbMin'):
        raise ValueError(f'Missing vehicle extent: {source}')
    dimensions = [a-b for a, b in zip(extent['bbMax'], extent['bbMin'])]
    engines = arr(lv.get('engines'))
    power = sum(e.get('power', 0) for e in engines)
    effort = sum(e.get('tractiveEffort', 0) for e in engines)
    modes = arr(tv.get('transportModes')); engine_modes = arr(tv.get('engineTransportModes'))
    availability = obj(meta.get('availability')); emissions = obj(meta.get('emissions'))
    features = {'year_from': availability.get('yearFrom', 1900)-1900, 'top_speed': lv.get('topSpeed', 0), 'volume': math.prod(dimensions), 'power': power, 'tractive_effort': effort, 'weight_empty': lv.get('weightEmpty', 0), 'has_engine_transport_modes': int(bool(engine_modes))}
    for e in engines:
        key = 'has_engine_type_' + e['type']; features[key] = features.get(key, 0)+1
    for mode in modes:
        features['has_transport_mode_' + mode] = 1
    def inferred(key):
        weights = models[tv['carrier']][key]
        prediction = weights.get('_intercept', 0) + sum(features.get(k, 0)*v for k,v in weights.items() if k != '_intercept')
        if key == 'load_speed':
            return max(1, round_game(prediction*2)/2)
        return (1 if key == 'comfort_factor' else 100) / (1+math.exp(-prediction))
    comfort = tv.get('comfortFactor', -1)
    if comfort < 0: comfort = inferred('comfort_factor')
    load_speed = tv.get('loadSpeed', -1)
    if load_speed < 0: load_speed = inferred('load_speed')
    noise = obj(emissions.get('noise')).get('score', -1)
    pollution = obj(emissions.get('pollution')).get('score', -1)
    if noise < 0: noise = round_game(inferred('noise_score'))
    if pollution < 0: pollution = round_game(inferred('pollution_score'))
    capacities = capacity_by_cargo(tv, cargos)
    # Direct port of base/model_metadata_util.lua:addCostMetadata in TF3.
    max_capacity = 0
    for compartment in arr(tv.get('compartments', tv.get('compartmentsList', []))):
        choices = []
        for config in arr(compartment.get('loadConfigs')):
            entry = obj(config.get('cargoEntry')); rules = obj(entry.get('cargoTypeSet'))
            if rules.get('cargoClassesIncluded') or rules.get('cargoTypesIncluded'):
                choices.append(entry.get('capacity', 0))
        max_capacity += max(choices, default=0)/4
    speed = lv.get('topSpeed', 0)*3.6
    average_speed = ((speed**0.78+4) if tv['carrier'] in ['ROAD','TRAM'] else (speed**0.86+10))/3.6
    c = 3700/1000*365*4/8
    if tv['carrier'] == 'ROAD' or (tv['carrier'] == 'TRAM' and power > 0 and max_capacity > 0):
        running = round_game(average_speed*max_capacity*c)
    else:
        running = round_game(average_speed*max_capacity*c*0.5)
        if power > 0:
            running += round_game(average_speed*(power/speed*12.5)*c*0.5)
    cost = obj(meta.get('cost')); maintenance = obj(meta.get('maintenance'))
    purchase = cost.get('price', -1)
    if purchase < 0: purchase = round_game(running*6*cost.get('priceScale', 1))
    yearly = maintenance.get('runningCosts', -1)
    if yearly < 0: yearly = round_game(running*maintenance.get('runningCostScale', 1))
    return {
        'id': source, 'name': translate(obj(meta.get('description')).get('name', source)),
        'source': source, 'category': source.split('/')[1], 'carrier': tv['carrier'],
        'modes': modes, 'engineModes': engine_modes,
        'yearFrom': availability.get('yearFrom', 0), 'yearTo': availability.get('yearTo', 0) or None,
        'length': round(dimensions[0], 5), 'speed': round(speed, 3), 'power': power,
        'tractiveEffort': effort, 'weightEmpty': lv.get('weightEmpty', 0),
        'weightMaxPayload': lv.get('weightMaxPayload', 0), 'friction': lv.get('friction', 0.02),
        'engineType': '+'.join(sorted(set(e['type'] for e in engines))) or None,
        'capacities': capacities, 'loadSpeed': load_speed, 'comfort': comfort*100,
        'noise': noise, 'pollution': pollution, 'purchase': purchase, 'running': yearly,
        'fixedFormation': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', default=DEFAULT_GAME)
    parser.add_argument('--output', default=str(pathlib.Path(__file__).resolve().parents[1]/'src/data/tf3-vehicles.json'))
    args = parser.parse_args()
    game = pathlib.Path(args.game_dir)
    if not (game/'TransportFever3.exe').exists():
        raise SystemExit('Expected a Transport Fever 3 installation (TransportFever3.exe missing).')
    root = game/'base/content'
    with (game/'base/strings/en/LC_MESSAGES/base.mo').open('rb') as f:
        translate = gettext.GNUTranslations(f).gettext
    digest = hashlib.sha256()
    with zipfile.ZipFile(root/'base.zip') as z:
        model_text = z.read('base/vehicle_stats_data.lua').decode()
        models = table(model_text, 'return ')
        cost_source = z.read('base/model_metadata_util.lua')
        digest.update(cost_source); digest.update(model_text.encode())
        # Fail clearly if a game update changes the cost model; review the port first.
        cost_text = cost_source.decode().replace('\r\n', '\n')
        cost_functions = cost_text[cost_text.index('local getTransportVehicleMaxCapacity'):cost_text.index('local turnToLandVehicle')]
        expected_cost_hash = '1cc7926d5e4e9254f4edeef6a4b5a31baddb85aa33b6e6a804e37385002e218b'
        if hashlib.sha256(cost_functions.encode()).hexdigest() != expected_cost_hash:
            raise SystemExit('TF3 cost model changed. Update normalize() against base/model_metadata_util.lua.')
    cargos = []
    for path in sorted((root/'cargos').glob('*.zip')):
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith('.cargo.lua'):
                    text = z.read(name).decode('utf-8-sig'); digest.update(text.encode())
                    data = table(text, 'return')
                    cargos.append({'id': data.get('id', path.stem.upper()), 'name': translate(data['name']), 'classes': arr(data.get('cargoClasses')), 'weightFactor': data.get('weightFactor', 1), 'loadSpeedFactor': data.get('loadSpeedFactor', 1), 'order': data.get('order', 999)})
    vehicles, formations, hidden = {}, [], set()
    for category in ['train', 'tram', 'waggon', 'bus', 'truck']:
        for path in sorted((root/'vehicle'/category).glob('*.zip')):
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    if not name.endswith(('.mdl', '.mu.lua')): continue
                    text = z.read(name).decode('utf-8-sig'); digest.update(text.encode())
                    source = f'vehicle/{category}/{name}'
                    try:
                        if name.endswith('.mu.lua'):
                            data = table(text, 'return')
                            refs = [f'vehicle/{category}/{pathlib.PurePosixPath(name).parent}/{v["name"]}' for v in data['vehicles']]
                            formations.append((source, data, refs)); hidden.update(refs)
                        elif re.search(r'\bmetadata\s*=', text):
                            meta = table(text, re.search(r'\bmetadata\s*=', text).group())
                            if not meta.get('extent') and 'boundingInfo =' in text:
                                meta['extent'] = table(text, 'boundingInfo =')
                            vehicle = normalize(meta, source, cargos, translate, models)
                            if vehicle: vehicles[source] = vehicle
                    except Exception as error:
                        raise RuntimeError(f'{path.name}:{name}: {error}') from error
    # Keep authored articulated/multiple-unit vehicles intact; never expose their loose parts.
    for source, data, refs in formations:
        parts = [vehicles[r] for r in refs]
        v = dict(parts[0]); v.update(id=source, source=source, name=translate(data['name']), fixedFormation=True, parts=[{'name':p['name'], 'source':p['source']} for p in parts])
        for key in ['length','power','tractiveEffort','weightEmpty','weightMaxPayload','noise','pollution','purchase','running']:
            v[key] = sum(p[key] for p in parts)
        v['speed'] = min(p['speed'] for p in parts)
        v['yearFrom'] = max(p['yearFrom'] for p in parts)
        v['yearTo'] = min((p['yearTo'] for p in parts if p['yearTo']), default=None)
        v['capacities'] = {c['id']:sum(p['capacities'].get(c['id'],0) for p in parts) for c in cargos if any(c['id'] in p['capacities'] for p in parts)}
        passenger_capacity = sum(p['capacities'].get('PASSENGERS',0) for p in parts)
        v['comfort'] = sum(p['comfort']*p['capacities'].get('PASSENGERS',0) for p in parts)/passenger_capacity if passenger_capacity else 0
        v['loadSpeed'] = sum(p['loadSpeed'] for p in parts if p['capacities'])
        vehicles[source] = v
    result = [v for k,v in sorted(vehicles.items()) if k not in hidden and (v['power'] > 0 or v['capacities'])]
    output = {'game':'Transport Fever 3', 'extractedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'definitionHash':digest.hexdigest(), 'source':'Installed TF3 base vehicle, cargo, localization and metadata definitions', 'costModelHash':hashlib.sha256(cost_source).hexdigest(), 'cargos':sorted(cargos,key=lambda c:c['order']), 'vehicles':result, 'counts':{'vehicles':len(result),'cargoTypes':len(cargos),'fixedFormations':len(formations),'hiddenFormationParts':len(hidden)}}
    dest = pathlib.Path(args.output); dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n',encoding='utf8')
    print(json.dumps(output['counts'])); print(f'Wrote {dest}')


if __name__ == '__main__':
    main()
