"""Export TF3 menu icons and approximate body-color swatches. Standard library only.

Run after extract_tf3.py; no game files are read by the web app at runtime.
"""
import argparse
import hashlib
import json
import pathlib
import struct
import zipfile
import zlib

from extract_tf3 import DEFAULT_GAME

PROJECT = pathlib.Path(__file__).resolve().parents[1]


def decode_tga(data):
    """Read the uncompressed true-color TGA format used by TF3 menu icons."""
    if len(data) < 18:
        raise ValueError('Truncated TGA header')
    id_size, color_map, image_type, _, _, _, _, _, width, height, depth, descriptor = struct.unpack('<BBBHHBHHHHBB', data[:18])
    if color_map or image_type != 2 or depth not in (24, 32) or not (0 < width <= 8192 and 0 < height <= 8192):
        raise ValueError('Unsupported TGA format; expected uncompressed 24/32-bit true color')
    channels = depth // 8
    start = 18 + id_size
    if len(data) < start + width * height * channels:
        raise ValueError('Truncated TGA pixels')
    pixels = bytearray(width * height * 4)
    for y in range(height):
        source_y = y if descriptor & 32 else height - 1 - y
        for x in range(width):
            source_x = width - 1 - x if descriptor & 16 else x
            offset = start + (source_y * width + source_x) * channels
            b, g, r = data[offset:offset + 3]
            a = data[offset + 3] if channels == 4 else 255
            dest = (y * width + x) * 4
            pixels[dest:dest + 4] = bytes((r, g, b, a))
    return width, height, bytes(pixels)


def png_bytes(width, height, rgba):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    stride = width * 4
    rows = b''.join(b'\0' + rgba[y * stride:(y + 1) * stride] for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


def body_color(width, height, rgba):
    # Sample the central body, excluding transparent background, dark wheels and
    # white highlights. Quantization groups shading; modest chroma weighting
    # keeps colored body panels from being overwhelmed by grey trim.
    bins = {}
    for y in range(int(height * .2), max(int(height * .75), 1)):
        for x in range(width):
            i = (y * width + x) * 4
            r, g, b, a = rgba[i:i + 4]
            if a < 200 or max(r, g, b) < 45 or min(r, g, b) > 238:
                continue
            key = (r // 32, g // 32, b // 32)
            bucket = bins.setdefault(key, [0, 0, 0, 0])
            bucket[0] += 1; bucket[1] += r; bucket[2] += g; bucket[3] += b
    if not bins:
        return '#59636b'
    def score(bucket):
        count, r, g, b = bucket
        return count * (1 + 1.5 * (max(r, g, b) - min(r, g, b)) / max(r, g, b, 1))
    count, r, g, b = max(bins.values(), key=score)
    return '#%02x%02x%02x' % (round(r / count), round(g / count), round(b / count))


def thumbnail_offset_y(width, height, rgba):
    """Fraction of image height to shift so visible artwork, not padding, is centered."""
    visible_rows = [y for y in range(height) if any(rgba[(y * width + x) * 4 + 3] >= 32 for x in range(width))]
    if not visible_rows:
        return 0
    center = (visible_rows[0] + visible_rows[-1] + 1) / 2
    return round((height / 2 - center) / height, 6)


def icon_location(vehicle):
    # TF3's authored multiple units have icons for their component models. Use
    # the first listed part (the leading vehicle), never an arbitrary filename.
    source = vehicle['parts'][0]['source'] if vehicle.get('fixedFormation') and vehicle.get('parts') else vehicle['source']
    path = pathlib.PurePosixPath(source)
    if path.is_absolute() or '..' in path.parts or len(path.parts) != 4 or path.parts[0] != 'vehicle' or path.suffix != '.mdl':
        raise ValueError(f'Unexpected vehicle model path: {source}')
    category, archive = path.parts[1:3]
    member = str(pathlib.PurePosixPath(archive) / 'icons' / (path.stem + '_icon_small@2x.tga'))
    image = f'{category}/{archive}/{path.stem}.png'
    return category, archive, member, image, source


def extract(game_dir, catalog, output, image_dir):
    game = pathlib.Path(game_dir)
    if not (game / 'TransportFever3.exe').exists():
        raise ValueError('Expected a Transport Fever 3 installation (TransportFever3.exe missing).')
    data = json.loads(pathlib.Path(catalog).read_text(encoding='utf8'))
    visuals = {}; digest = hashlib.sha256(); total_bytes = 0
    for vehicle in data['vehicles']:
        category, archive, member, image, source = icon_location(vehicle)
        with zipfile.ZipFile(game / 'base/content/vehicle' / category / (archive + '.zip')) as z:
            raw = z.read(member)  # A missing icon fails clearly after a game update.
        digest.update(vehicle['id'].encode()); digest.update(raw)
        width, height, rgba = decode_tga(raw)
        png = png_bytes(width, height, rgba)
        destination = pathlib.Path(image_dir) / image
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(png); total_bytes += len(png)
        visuals[vehicle['id']] = {'image': '/vehicles/' + image, 'width': width, 'height': height,
                                  'thumbnailOffsetY': thumbnail_offset_y(width, height, rgba),
                                  'color': body_color(width, height, rgba), 'sourceIcon': f'vehicle/{category}/{member}',
                                  'representativePart': source if source != vehicle['source'] else None}
    result = {'game': 'Transport Fever 3', 'source': 'Installed TF3 base menu icons; unmodified base colors before company tinting',
              'iconHash': digest.hexdigest(), 'vehicles': visuals}
    pathlib.Path(output).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'Exported {len(visuals)} TF3 menu icons ({total_bytes:,} PNG bytes) and sampled body colors.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', default=DEFAULT_GAME)
    parser.add_argument('--catalog', default=str(PROJECT / 'src/data/tf3-vehicles.json'))
    parser.add_argument('--output', default=str(PROJECT / 'src/data/tf3-vehicle-visuals.json'))
    parser.add_argument('--image-dir', default=str(PROJECT / 'public/vehicles'))
    args = parser.parse_args()
    extract(args.game_dir, args.catalog, args.output, args.image_dir)
