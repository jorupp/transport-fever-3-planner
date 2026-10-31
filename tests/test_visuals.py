import pathlib
import struct
import sys
import unittest
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import extract_tf3_visuals as visuals


class VisualTests(unittest.TestCase):
    def test_tga_bottom_origin_bgra_becomes_top_origin_rgba_with_alpha(self):
        header = struct.pack('<BBBHHBHHHHBB', 0, 0, 2, 0, 0, 0, 0, 0, 1, 2, 32, 0)
        self.assertEqual(visuals.decode_tga(header + bytes([0, 0, 255, 128, 255, 0, 0, 255])),
                         (1, 2, bytes([0, 0, 255, 255, 255, 0, 0, 128])))
        with self.assertRaises(ValueError): visuals.decode_tga(header)

    def test_png_preserves_transparency_and_pixel_values(self):
        pixel = bytes([20, 60, 90, 125])
        png = visuals.png_bytes(1, 1, pixel)
        self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
        length = struct.unpack('>I', png[33:37])[0]
        self.assertEqual(png[37:41], b'IDAT')
        self.assertEqual(zlib.decompress(png[41:41 + length]), b'\0' + pixel)

    def test_color_ignores_transparent_background_and_dark_wheels(self):
        blue = bytes([40, 90, 140, 255])
        pixels = bytes([255, 0, 0, 0]) * 10 + blue * 10 + bytes([5, 5, 5, 255]) * 10
        self.assertEqual(visuals.body_color(10, 3, pixels), '#285a8c')

    def test_fixed_sets_use_the_first_authored_part_and_paths_stay_relative(self):
        vehicle = {'source': 'vehicle/train/set/set.mu.lua', 'fixedFormation': True,
                   'parts': [{'source': 'vehicle/train/set/front.mdl'}]}
        category, archive, icon, image, source = visuals.icon_location(vehicle)
        self.assertEqual((category, archive, icon, image, source),
                         ('train', 'set', 'set/icons/front_icon_small@2x.tga', 'train/set/front.png', 'vehicle/train/set/front.mdl'))
        with self.assertRaises(ValueError): visuals.icon_location({'source': 'vehicle/train/../../evil.mdl'})
