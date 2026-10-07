"""Fixture tests for map_library.py and map_fit.py.

    python -m unittest scripts/test_map_tools.py

Builds a tiny NeDB scene-pack module in a temp dir (a cave blob on black with one prop and one
light, walls around the blob in Foundry's padded canvas coordinates), catalogues it, and fits its
walls to a "repaint" that is the source shifted by a few pixels. No pack art, no API.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import map_fit  # noqa: E402
import map_library as ml  # noqa: E402

GRID = 20
W, H = 22 * GRID, 17 * GRID          # 440×340, the Cartos proportions
ORIGIN = (ml.math.ceil(W * 0.25 / GRID) * GRID, ml.math.ceil(H * 0.25 / GRID) * GRID)  # (120, 100)
BLOB = (60, 0, 300, 260)             # x0, y0, x1, y1: floor touching the north edge
PROP = (150, 120, 210, 160)          # 60×40 px: over PROP_MIN_AREA; padded box 72×52 → 3.5×2.5 squares


def make_images() -> tuple[np.ndarray, np.ndarray]:
    clean = np.zeros((H, W, 3), np.uint8)
    rng = np.random.default_rng(1)
    x0, y0, x1, y1 = BLOB
    clean[y0:y1, x0:x1] = (140, 120, 100)
    clean[y0:y1, x0:x1] += rng.integers(0, 30, (y1 - y0, x1 - x0, 1), dtype=np.uint8)
    # some structure inside the floor so vertex patches have something to match on
    for x in range(x0, x1, 25):
        cv2.line(clean, (x, y0), (x, y1), (90, 80, 70), 2)
    std = clean.copy()
    px0, py0, px1, py1 = PROP
    std[py0:py1, px0:px1] = (200, 40, 40)
    return std, clean


def make_module(root: Path) -> Path:
    mod = root / "test-caves-01"
    (mod / "maps").mkdir(parents=True)
    (mod / "packs").mkdir()
    std, clean = make_images()
    Image.fromarray(std).save(mod / "maps" / "TC_ItW Caves 01 Test Cave_No Grid_22x17.png")
    Image.fromarray(clean).save(mod / "maps" / "TC_ItW Caves 01 Test Cave Clean_No Grid_22x17.png")
    ox, oy = ORIGIN
    x0, y0, x1, y1 = BLOB
    walls = [
        {"_id": "w1", "c": [x0 + ox, y0 + oy, x0 + ox, y1 + oy], "door": 0},
        {"_id": "w2", "c": [x0 + ox, y1 + oy, x1 + ox, y1 + oy], "door": 0},
        {"_id": "w3", "c": [x1 + ox, y1 + oy, x1 + ox, y0 + oy], "door": 1},
    ]
    light = {"x": 200 + ox, "y": 200 + oy, "config": {"dim": 10, "bright": 5, "color": "#ff8800"}}

    def doc(_id, name, img, extra_walls=()):
        return {
            "_id": _id, "name": name, "width": W, "height": H, "padding": 0.25,
            "grid": {"type": 1, "size": GRID}, "background": {"src": f"modules/test-caves-01/maps/{img}"},
            "walls": walls + list(extra_walls), "lights": [light], "tiles": [],
        }
    with open(mod / "packs" / "test-caves-01.db", "w", encoding="utf-8") as f:
        f.write(json.dumps(doc("s1", "ItW Caves 01a Test Cave", "TC_ItW Caves 01 Test Cave_No Grid_22x17.png")) + "\n")
        f.write(json.dumps(doc("s2", "ItW Caves 01a Test Cave - Clean", "TC_ItW Caves 01 Test Cave Clean_No Grid_22x17.png")) + "\n")
        # an appended update to s2 (NeDB is append-only): the last record wins
        f.write(json.dumps(doc("s2", "ItW Caves 01a Test Cave - Clean", "TC_ItW Caves 01 Test Cave Clean_No Grid_22x17.png")) + "\n")
    with open(mod / "module.json", "w", encoding="utf-8") as f:
        json.dump({"id": "test-caves-01", "title": "Test Caves", "version": "1",
                   "packs": [{"name": "test-caves-01", "path": "packs/test-caves-01.db", "type": "Scene"}]}, f)
    return mod


class MapLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="maplib-test-"))
        cls.mod = make_module(cls.tmp)
        cls.out = cls.tmp / "_catalogue"
        cls.out.mkdir()
        cls.rec = ml.catalogue_module(cls.mod, cls.out, "node", props=True)
        ml.write_index(cls.out)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_names(self):
        self.assertEqual(ml.split_name("ItW Caves 02a River Dock Cave - Closed Clean"),
                         ("ItW Caves 02a River Dock Cave", "clean", "Closed"))
        self.assertEqual(ml.family_title("Into the Wilds: Caves 01a Bear's Den"), "Bear's Den")
        self.assertEqual(ml.family_title("ItW Caves 04 - 01 Storage Room"), "Storage Room")
        self.assertEqual(ml.family_title("ItW Caves 04 - 05 Combined"), "Combined 05")

    def test_family_and_variants(self):
        fams = self.rec["families"]
        self.assertEqual(len(fams), 1)
        fam = fams[0]
        self.assertEqual(fam["slug"], "test-cave")
        self.assertEqual(fam["squares"], [22, 17])
        self.assertEqual(sorted(s["role"] for s in fam["scenes"]), ["clean", "standard"])
        self.assertEqual(len(fam["scenes"]), 2, "the appended NeDB record must not duplicate the scene")

    def test_sidecar_is_on_image_pixels(self):
        fam = self.rec["families"][0]
        std = next(s for s in fam["scenes"] if s["role"] == "standard")
        with open(self.out / std["sidecar"], encoding="utf-8") as f:
            side = json.load(f)
        self.assertEqual(side["origin"], list(ORIGIN))
        self.assertEqual(side["walls"][0]["c"], [BLOB[0], BLOB[1], BLOB[0], BLOB[3]])
        self.assertEqual(side["lights"][0]["x"], 200)
        self.assertEqual(std["doors"], 1)

    def test_exits_props_and_index(self):
        fam = self.rec["families"][0]
        edges = {e["edge"] for e in fam["exits"]}
        self.assertEqual(edges, {"N"}, "the blob touches only the north edge")
        n = next(e for e in fam["exits"] if e["edge"] == "N")
        self.assertAlmostEqual(n["start"], BLOB[0] / GRID, delta=0.3)
        self.assertAlmostEqual(n["end"], BLOB[2] / GRID, delta=0.3)
        self.assertEqual(len(fam["props"]), 1)
        self.assertEqual(fam["props"][0]["footprint"], [3.5, 2.5])
        self.assertTrue((self.out / "props" / "test-caves-01" / fam["props"][0]["file"]).is_file())
        self.assertTrue((self.out / "contact-test-caves-01.jpg").is_file())
        with open(self.out / "index.json", encoding="utf-8") as f:
            idx = json.load(f)
        self.assertEqual(idx["families"][0]["slug"], "test-cave")

    def test_light_class(self):
        self.assertEqual(ml.light_class({"config": {"color": "#ff8800"}}), "fire")
        self.assertEqual(ml.light_class({"config": {"color": "#44da99"}}), "cyan")
        self.assertEqual(ml.light_class({"config": {"color": ""}}), "white")


class MapFitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mapfit-test-"))
        self.mod = make_module(self.tmp)
        self.out = self.tmp / "_catalogue"
        self.out.mkdir()
        rec = ml.catalogue_module(self.mod, self.out, "node", props=False)
        std = next(s for s in rec["families"][0]["scenes"] if s["role"] == "standard")
        self.source = self.mod / std["image"]
        self.sidecar = self.out / std["sidecar"]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_fit(self, result: Path, *extra: str) -> dict:
        stem = self.tmp / "fit"
        r = subprocess.run([sys.executable, str(HERE / "map_fit.py"), str(self.source), str(self.sidecar),
                            str(result), str(stem), *extra], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(str(stem) + ".fitted.json", encoding="utf-8") as f:
            fitted = json.load(f)
        return {"report": json.loads(r.stdout), "fitted": fitted}

    def test_identity(self):
        r = self.run_fit(self.source)
        self.assertEqual(r["report"]["floor_iou"], 1.0)
        self.assertEqual(r["report"]["movers"], 0)
        self.assertEqual(r["report"]["snap_p90_px"], 0.0)

    def test_shifted_repaint_snaps(self):
        std = np.asarray(Image.open(self.source).convert("RGB"))
        shifted = np.roll(std, (3, 5), axis=(0, 1))     # down 3, right 5
        res = self.tmp / "shifted.png"
        Image.fromarray(shifted).save(res)
        r = self.run_fit(res)
        self.assertEqual(r["report"]["movers"], 0)
        self.assertGreaterEqual(r["report"]["floor_iou"], 0.95)
        w1 = r["fitted"]["walls"][0]["c"]
        self.assertEqual(w1[0], BLOB[0] + 5)
        self.assertEqual(w1[3], BLOB[3] + 3)

    def test_upscaled_repaint_scales_walls(self):
        std = np.asarray(Image.open(self.source).convert("RGB"))
        res = self.tmp / "big.png"
        Image.fromarray(cv2.resize(std, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)).save(res)
        r = self.run_fit(res)
        self.assertEqual(r["report"]["scale"], 2)
        self.assertEqual(r["fitted"]["grid"], GRID * 2)
        self.assertEqual(r["fitted"]["lights"][0]["x"], 400)
        self.assertEqual(r["fitted"]["walls"][0]["c"][0], BLOB[0] * 2)

    def test_non_integer_scale_is_refused(self):
        std = np.asarray(Image.open(self.source).convert("RGB"))
        res = self.tmp / "odd.png"
        Image.fromarray(cv2.resize(std, (W + 7, H + 5))).save(res)
        r = subprocess.run([sys.executable, str(HERE / "map_fit.py"), str(self.source), str(self.sidecar),
                            str(res), str(self.tmp / "odd")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
