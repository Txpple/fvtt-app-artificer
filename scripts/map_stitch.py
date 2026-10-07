#!/usr/bin/env python
"""Stitch repainted single maps into a pack's Combined-sheet layout, then fit the sheet's walls.

    python map_stitch.py CATALOGUE MODULE COMBINED_SLUG OUT_STEM family=render.webp [family=render.webp ...]

The catalogue (map_library.py) knows which single map sits in each cell of a Combined sheet.
Each cell is filled with that family's repaint (same pixel size as the pack's single map), the
colour step across every seam is ramped out over 1.5 squares on each side, and map_fit.py fits
the sheet's own walls and lights to the stitched painting. Writes OUT_STEM.webp (or .png past
WebP's limit) and the fit's .fitted.json / .overlay.jpg / .report.json.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
RAMP_SQUARES = 1.5
LIT = 40            # a pixel brighter than this in any channel is painting, not void


def ramp_seam(sheet: np.ndarray, pos: int, axis: int, grid: int) -> np.ndarray | None:
    """Ramp the mean colour step across one seam (a row index for axis 0, a column for axis 1)."""
    band, ramp = int(0.5 * grid), int(RAMP_SQUARES * grid)
    take = (lambda a, b: sheet[a:b]) if axis == 0 else (lambda a, b: sheet[:, a:b])
    before, after = take(pos - band, pos), take(pos, pos + band)
    mb, ma = before.max(axis=2) > LIT, after.max(axis=2) > LIT
    if mb.sum() < 1000 or ma.sum() < 1000:
        return None
    diff = after[ma].mean(axis=0) - before[mb].mean(axis=0)
    for i in range(ramp):
        w = 0.5 * (1 - i / ramp)
        if axis == 0:
            sheet[pos - 1 - i] += diff * w
            sheet[pos + i] -= diff * w
        else:
            sheet[:, pos - 1 - i] += diff * w
            sheet[:, pos + i] -= diff * w
    return diff


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("catalogue", type=Path)
    ap.add_argument("module")
    ap.add_argument("combined")
    ap.add_argument("out_stem", type=Path)
    ap.add_argument("renders", nargs="+", help="family=path of that family's repaint")
    a = ap.parse_args(argv)

    with open(a.catalogue / f"{a.module}.json", encoding="utf-8") as f:
        rec = json.load(f)
    comb = rec["combined"].get(a.combined)
    fam = next((f for f in rec["families"] if f["slug"] == a.combined), None)
    if not comb or not fam:
        print(f"no Combined family {a.combined!r} in {a.module}", file=sys.stderr)
        return 2
    renders = dict(r.split("=", 1) for r in a.renders)
    missing = [t["family"] for t in comb["tiles"] if t["family"] not in renders]
    if missing:
        print(f"no render given for tiles: {missing}", file=sys.stderr)
        return 2
    std = next((s for s in fam["scenes"] if s["role"] == "standard"), fam["scenes"][0])
    grid = std["grid"]
    module_dir = Path(rec["path"])

    tiles = {(t["col"], t["row"]): np.asarray(Image.open(renders[t["family"]]).convert("RGB")).astype(np.float32)
             for t in comb["tiles"]}
    th, tw = next(iter(tiles.values())).shape[:2]
    cols = max(c for c, _ in tiles) + 1
    rows = max(r for _, r in tiles) + 1
    sheet = np.zeros((rows * th, cols * tw, 3), np.float32)
    for (c, r), img in tiles.items():
        if img.shape[:2] != (th, tw):
            print("every render must have the same size", file=sys.stderr)
            return 2
        sheet[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = img
    k = sheet.shape[1] / std["width"]
    if abs(k - round(k)) > 1e-6:
        print(f"renders are not a whole-number scale of the sheet ({k:.3f})", file=sys.stderr)
        return 2
    g = int(grid * round(k))
    for r in range(1, rows):
        d = ramp_seam(sheet, r * th, 0, g)
        print(f"seam row {r}: colour step {None if d is None else np.round(d, 1).tolist()}")
    for c in range(1, cols):
        d = ramp_seam(sheet, c * tw, 1, g)
        print(f"seam col {c}: colour step {None if d is None else np.round(d, 1).tolist()}")
    out = np.clip(sheet, 0, 255).astype(np.uint8)
    ext = "webp" if max(out.shape[:2]) <= 16383 else "png"
    stitched = Path(f"{a.out_stem}.{ext}")
    stitched.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(stitched, quality=90)
    print(f"stitched {out.shape[1]}x{out.shape[0]} -> {stitched}")

    r = subprocess.run([sys.executable, str(HERE / "map_fit.py"), str(module_dir / std["image"]),
                        str(a.catalogue / std["sidecar"]), str(stitched), str(a.out_stem)],
                       capture_output=True, text=True)
    if r.returncode:
        print(r.stderr, file=sys.stderr)
        return r.returncode
    print(r.stdout.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
