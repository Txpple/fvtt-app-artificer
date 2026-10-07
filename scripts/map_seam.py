#!/usr/bin/env python
"""Seam-blend pass for a stitched super map (map_stitch.py), in two halves around a repaint.

    python map_seam.py cut   STITCHED.webp OUT_DIR [--band 6] [--grid 140]
    python map_seam.py paste STITCHED.webp OUT_DIR band=render.webp [band=render.webp ...]
                             [--feather 0.5] [--out FINAL.webp]

`cut` writes one PNG per seam (`seam-row-1.png`, `seam-col-1.png`...), each a band --band
squares wide centred on the seam, plus `seams.json` with where each band came from. The seams
are the tile joins: the stitched map is cols×rows tiles of equal size, and every internal
join is a seam. The band is what to send through `edit-image` `battlemap` with a blend
instruction ("the two halves are one continuous painting: one water, one rock, one floor").

`paste` takes each band's render (it comes back on the band's own pixel grid), feathers it
into the stitched map over --feather squares at the band's top and bottom (or left and
right), and writes the final map. Run map_fit.py on the result afterwards; walls at the seam
may have moved a little.

Why a band and not the whole sheet: the sheet is already at the render's resolution, and the
model only needs to see what it is matching on either side of the line.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def tile_grid(w: int, h: int, grid: int) -> tuple[int, int]:
    """Infer cols×rows of 22×17-square tiles (the Cartos sheet shape) from the sheet size."""
    tw, th = 22 * grid, 17 * grid
    cols, rows = round(w / tw), round(h / th)
    if cols * tw != w or rows * th != h:
        raise SystemExit(f"{w}×{h} is not a whole number of 22×17 tiles at {grid} px")
    return cols, rows


def cut(a) -> int:
    img = np.asarray(Image.open(a.stitched).convert("RGB"))
    h, w = img.shape[:2]
    cols, rows = tile_grid(w, h, a.grid)
    half = int(a.band * a.grid / 2)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    seams = []
    for r in range(1, rows):
        y = r * (h // rows)
        y0, y1 = max(0, y - half), min(h, y + half)
        name = f"seam-row-{r}.png"
        Image.fromarray(img[y0:y1]).save(out / name)
        seams.append({"name": name, "axis": "row", "pos": y, "y0": y0, "y1": y1, "x0": 0, "x1": w})
    for c in range(1, cols):
        x = c * (w // cols)
        x0, x1 = max(0, x - half), min(w, x + half)
        name = f"seam-col-{c}.png"
        Image.fromarray(img[:, x0:x1]).save(out / name)
        seams.append({"name": name, "axis": "col", "pos": x, "x0": x0, "x1": x1, "y0": 0, "y1": h})
    with open(out / "seams.json", "w", encoding="utf-8") as f:
        json.dump({"stitched": str(a.stitched), "grid": a.grid, "band": a.band, "seams": seams}, f, indent=1)
    for s in seams:
        print(f"{s['name']}: {s['axis']} seam at {s['pos']} px, band {s['x1']-s['x0']}×{s['y1']-s['y0']}")
    return 0


def paste(a) -> int:
    out_dir = Path(a.out_dir)
    with open(out_dir / "seams.json", encoding="utf-8") as f:
        meta = json.load(f)
    grid = meta["grid"]
    sheet = np.asarray(Image.open(a.stitched).convert("RGB")).astype(np.float32)
    renders = dict(r.split("=", 1) for r in a.renders)
    feather = int(a.feather * grid)
    for s in meta["seams"]:
        if s["name"] not in renders:
            print(f"no render for {s['name']}, left as is", file=sys.stderr)
            continue
        band = np.asarray(Image.open(renders[s["name"]]).convert("RGB")).astype(np.float32)
        bh, bw = s["y1"] - s["y0"], s["x1"] - s["x0"]
        if band.shape[:2] != (bh, bw):
            print(f"{s['name']}: render is {band.shape[1]}×{band.shape[0]}, band is {bw}×{bh}", file=sys.stderr)
            return 2
        # Alpha ramps from 0 at the band's outer edges to 1 inside, so the band's own borders
        # never show as a new seam.
        if s["axis"] == "row":
            ramp = np.ones(bh, np.float32)
            n = min(feather, bh // 2)
            ramp[:n] = np.linspace(0, 1, n)
            ramp[bh - n:] = np.linspace(1, 0, n)
            alpha = ramp[:, None, None]
        else:
            ramp = np.ones(bw, np.float32)
            n = min(feather, bw // 2)
            ramp[:n] = np.linspace(0, 1, n)
            ramp[bw - n:] = np.linspace(1, 0, n)
            alpha = ramp[None, :, None]
        region = sheet[s["y0"]:s["y1"], s["x0"]:s["x1"]]
        sheet[s["y0"]:s["y1"], s["x0"]:s["x1"]] = region * (1 - alpha) + band * alpha
        print(f"{s['name']}: blended in")
    final = Path(a.out) if a.out else Path(str(a.stitched).rsplit(".", 1)[0] + "-blended.webp")
    Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8)).save(final, quality=90)
    print(f"wrote {final}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cut")
    c.add_argument("stitched", type=Path)
    c.add_argument("out_dir", type=Path)
    c.add_argument("--band", type=float, default=6.0, help="band height in squares")
    c.add_argument("--grid", type=int, default=140)
    c.set_defaults(fn=cut)
    p = sub.add_parser("paste")
    p.add_argument("stitched", type=Path)
    p.add_argument("out_dir", type=Path)
    p.add_argument("renders", nargs="+", help="seam-row-1.png=render.webp")
    p.add_argument("--feather", type=float, default=0.5, help="squares")
    p.add_argument("--out", type=Path)
    p.set_defaults(fn=paste)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
