#!/usr/bin/env python
"""Draw an atlas of a map set: every scene as a thumbnail, the exits that link them as coloured
bands, and a line for every proposed connector (a teleporter pair in Foundry).

    python map_atlas.py ATLAS.json OUT.jpg [--scale 0.125]

ATLAS.json:
{
  "grid": 140,
  "scenes": {
    "the-door": {"image": "...webp", "title": "The Door", "at": [x, y]},   # x, y in squares on the atlas
    ...
  },
  "nodes": {"outside": {"title": "Outside: the ridge", "at": [x, y], "size": [w, h]}},
  "links": [
    {"a": ["the-door", "N", 12.3, 17.0], "b": ["outside"], "note": "the Door slab"},
    {"a": ["the-door", "S", 13, 18], "b": ["hall-and-tunnels", "N", 8.5, 12.5], "note": "the climb"}
  ]
}
Every link end is [scene, edge, from, to] in that scene's squares, or [node]. The same file is
what links.json for the Foundry placement step is written from.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
COLOURS = [(80, 160, 255), (255, 170, 60), (120, 230, 120), (255, 110, 200), (255, 240, 90),
           (90, 230, 230), (230, 120, 90), (180, 140, 255), (200, 200, 200)]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("atlas", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--scale", type=float, default=0.125, help="atlas pixels per map pixel")
    a = ap.parse_args(argv)
    with open(a.atlas, encoding="utf-8") as f:
        atlas = json.load(f)
    grid = atlas.get("grid", 140)
    sq = grid * a.scale                          # atlas pixels per square
    pad = 40

    # Load and place scenes; the canvas is sized to fit everything.
    placed = {}
    extent = [0, 0]
    for name, sc in atlas["scenes"].items():
        img = Image.open(sc["image"]).convert("RGB")
        w, h = int(img.width * a.scale), int(img.height * a.scale)
        img = img.resize((w, h), Image.LANCZOS)
        x, y = int(sc["at"][0] * sq) + pad, int(sc["at"][1] * sq) + pad
        placed[name] = {"img": img, "x": x, "y": y, "w": w, "h": h, "title": sc.get("title", name)}
        extent = [max(extent[0], x + w), max(extent[1], y + h)]
    for name, nd in atlas.get("nodes", {}).items():
        x, y = int(nd["at"][0] * sq) + pad, int(nd["at"][1] * sq) + pad
        w, h = int(nd["size"][0] * sq), int(nd["size"][1] * sq)
        placed[name] = {"img": None, "x": x, "y": y, "w": w, "h": h, "title": nd.get("title", name)}
        extent = [max(extent[0], x + w), max(extent[1], y + h)]

    canvas = Image.new("RGB", (extent[0] + pad, extent[1] + pad + 40), (18, 18, 20))
    dr = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
        small = ImageFont.truetype("arial.ttf", 16)
    except OSError:
        font = small = ImageFont.load_default()
    for name, p in placed.items():
        if p["img"] is not None:
            canvas.paste(p["img"], (p["x"], p["y"]))
            dr.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], outline=(70, 70, 75), width=2)
        else:
            dr.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], fill=(40, 48, 60), outline=(120, 160, 220), width=3)
        tw = dr.textlength(p["title"], font=font)
        dr.rectangle([p["x"], p["y"] - 30, p["x"] + tw + 16, p["y"] - 2], fill=(18, 18, 20))
        dr.text((p["x"] + 8, p["y"] - 28), p["title"], fill=(235, 235, 235), font=font)

    def anchor(end):
        """Centre point and band rectangle of a link end on the canvas."""
        p = placed[end[0]]
        if len(end) == 1:
            return (p["x"] + p["w"] // 2, p["y"] + p["h"] // 2), None
        edge, s, e = end[1], end[2] * sq, end[3] * sq
        t = 8
        if edge == "N":
            box = [p["x"] + s, p["y"] - t, p["x"] + e, p["y"] + t]
        elif edge == "S":
            box = [p["x"] + s, p["y"] + p["h"] - t, p["x"] + e, p["y"] + p["h"] + t]
        elif edge == "W":
            box = [p["x"] - t, p["y"] + s, p["x"] + t, p["y"] + e]
        else:
            box = [p["x"] + p["w"] - t, p["y"] + s, p["x"] + p["w"] + t, p["y"] + e]
        return ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), box

    for i, link in enumerate(atlas["links"]):
        col = COLOURS[i % len(COLOURS)]
        (ca, ba), (cb, bb) = anchor(link["a"]), anchor(link["b"])
        for box in (ba, bb):
            if box:
                dr.rectangle(box, fill=col)
        dr.line([ca, cb], fill=col, width=4)
        mx, my = (ca[0] + cb[0]) // 2, (ca[1] + cb[1]) // 2
        label = f"{i + 1}"
        dr.ellipse([mx - 14, my - 14, mx + 14, my + 14], fill=col)
        dr.text((mx - 6, my - 10), label, fill=(0, 0, 0), font=font)
        for c in (ca, cb):
            dr.ellipse([c[0] - 6, c[1] - 6, c[0] + 6, c[1] + 6], fill=col, outline=(0, 0, 0))

    # Legend
    y = extent[1] + pad - 30 + 40
    x = pad
    for i, link in enumerate(atlas["links"]):
        col = COLOURS[i % len(COLOURS)]
        def side(end):
            return end[0] if len(end) == 1 else f"{end[0]} {end[1]} {end[2]:g}-{end[3]:g}"
        text = f"{i + 1}. {side(link['a'])}  <->  {side(link['b'])}   {link.get('note', '')}"
        dr.rectangle([x, y + 4, x + 18, y + 22], fill=col)
        dr.text((x + 26, y), text, fill=(220, 220, 220), font=small)
        y += 24
        if y > canvas.height - 24:
            new = Image.new("RGB", (canvas.width, canvas.height + 24 * 6), (18, 18, 20))
            new.paste(canvas, (0, 0))
            canvas = new
            dr = ImageDraw.Draw(canvas)
    canvas.save(a.out, quality=90)
    print(f"wrote {a.out} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
