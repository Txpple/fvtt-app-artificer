#!/usr/bin/env python
"""Catalogue a shelf of pre-walled map modules (Tom Cartos style) for the map-builder.

    python map_library.py ROOT [--out DIR] [--only MODULE_ID ...] [--no-props] [--node node]

ROOT holds one unzipped Foundry scene-pack module per folder (a module.json plus packs/).
For each module the script writes, under --out (default ROOT/_catalogue):

    <module>.json                 the pack's catalogue: scene families, variants, exits,
                                  Combined-sheet adjacency, lights, doors, props, tags
    scenes/<module>/<id>.json     one sidecar per scene: walls + lights, Foundry-native,
                                  on the map's own pixel grid (the "walls in" for a repaint)
    thumbs/<module>/<slug>.jpg    thumbnail of each family's standard variant
    check/<module>/<slug>.jpg     the standard variant with its walls, doors and lights drawn
                                  on it: the eyeball test that the geometry is right
    props/<module>/<slug>-NN.png  props lifted from standard-minus-Clean, RGBA
    masks/<module>/<slug>.png     the floor mask (quarter size)
    contact-<module>.jpg          every family on one labelled sheet, for tagging
    index.json                    the shelf: every module, every family, one line each

Both pack eras are read: NeDB `.db` (newline JSON) directly, LevelDB directories through
unpack_leveldb.mjs (a node child using @foundryvtt/foundryvtt-cli). Tags are left empty for
Claude to fill from the contact sheet; nothing here calls an API.

Pack art is licensed. The catalogue lives beside the packs, never in git.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from urllib.parse import unquote

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

HERE = Path(__file__).resolve().parent
UNPACK = HERE / "unpack_leveldb.mjs"

# Variant words Tom Cartos hangs on the end of a scene name. Order-free: "Closed Clean" and
# "Clean Closed" both occur.
ROLE_TOKENS = {"Clean", "Simple"}
STATE_TOKENS = {
    "Open", "Closed", "Dry", "Wet", "Flooded", "Canopy", "Roof", "Snow", "Night", "Day",
    "Winter", "Summer", "Lit", "Dark", "Ruined", "Intact",
}
VARIANT_TOKENS = ROLE_TOKENS | STATE_TOKENS

VOID_LEVEL = 28          # blurred grey below this is void (the black around a cave)
VOID_BLUR = 6            # px
EXIT_BAND = 3            # px of the edge that count as "touching"
EXIT_MIN_SQUARES = 0.6   # a gap narrower than this is texture, not an exit
PROP_DIFF = 28           # per-channel difference standard vs Clean that counts as a prop
PROP_MIN_AREA = 1500     # px²
PROP_MAX = 80            # per family
THUMB_W = 512
CONTACT_W = 420
TILE_MATCH_MAX = 14.0    # mean abs diff (0-255) at thumbnail scale that still counts as the same art


# --------------------------------------------------------------------------- data

@dataclass
class Scene:
    id: str
    name: str
    image: str                      # module-relative path
    width: int
    height: int
    grid: int
    role: str                       # standard | clean | simple
    state: str                      # "" | "Open" | "Closed" | "Closed Dry" ...
    walls: int
    doors: int
    lights: int
    tiles: int
    sidecar: str                    # catalogue-relative path


@dataclass
class Exit:
    edge: str                       # N E S W
    start: float                    # squares along the edge (x for N/S, y for E/W)
    end: float


@dataclass
class Prop:
    file: str
    box: list                       # [x0, y0, x1, y1] px on the source
    footprint: list                 # [w, h] squares, to the half square
    area: int


@dataclass
class Family:
    slug: str
    title: str
    squares: list                   # [cols, rows]
    combined: bool
    scenes: list = field(default_factory=list)
    exits: list = field(default_factory=list)
    lights: int = 0
    doors: int = 0
    light_classes: dict = field(default_factory=dict)
    floor_fraction: float = 0.0
    thumb: str = ""
    check: str = ""
    mask: str = ""
    props: list = field(default_factory=list)
    tags: list = field(default_factory=list)


# --------------------------------------------------------------------------- pack reading

def read_module(mod_dir: Path) -> dict:
    with open(mod_dir / "module.json", encoding="utf-8") as f:
        return json.load(f)


def nedb_docs(db: Path) -> list[dict]:
    """NeDB is append-only newline JSON; the last record for an _id wins."""
    by_id: dict[str, dict] = {}
    with open(db, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            if d.get("$$deleted"):
                by_id.pop(d.get("_id"), None)
            else:
                by_id[d.get("_id")] = d
    return list(by_id.values())


def leveldb_docs(pack_dir: Path, node: str) -> list[dict]:
    dest = Path(tempfile.mkdtemp(prefix="maplib-"))
    try:
        subprocess.run([node, str(UNPACK), str(pack_dir), str(dest)], check=True,
                       capture_output=True, text=True)
        docs = []
        for p in sorted(dest.glob("*.json")):
            with open(p, encoding="utf-8") as f:
                docs.append(json.load(f))
        return docs
    finally:
        shutil.rmtree(dest, ignore_errors=True)


def scene_packs(mod_dir: Path, manifest: dict) -> list[Path]:
    """Scene compendium paths, preferring a LevelDB directory over a stale `.db` of the same name."""
    out = []
    for p in manifest.get("packs", []):
        if p.get("type") != "Scene":
            continue
        rel = p["path"].lstrip("/")
        as_dir = mod_dir / re.sub(r"\.db$", "", rel)
        as_db = mod_dir / (rel if rel.endswith(".db") else rel + ".db")
        if as_dir.is_dir():
            out.append(as_dir)
        elif as_db.is_file():
            out.append(as_db)
    return out


def read_scenes(mod_dir: Path, manifest: dict, node: str) -> list[dict]:
    docs = []
    for pack in scene_packs(mod_dir, manifest):
        docs += leveldb_docs(pack, node) if pack.is_dir() else nedb_docs(pack)
    return docs


def scene_image(mod_dir: Path, module_id: str, doc: dict) -> str | None:
    src = (doc.get("background") or {}).get("src") or doc.get("img")
    if not src:
        return None
    src = unquote(src)
    prefix = f"modules/{module_id}/"
    rel = src[len(prefix):] if src.startswith(prefix) else src.split("/", 2)[-1]
    return rel if (mod_dir / rel).is_file() else None


# --------------------------------------------------------------------------- naming

def split_name(name: str) -> tuple[str, str, str]:
    """'ItW Caves 02a River Dock Cave - Closed Clean' → ('ItW Caves 02a River Dock Cave', 'clean', 'Closed')."""
    tokens = name.replace(" - ", " ").split()
    roles, states = [], []
    while tokens and tokens[-1] in VARIANT_TOKENS:
        t = tokens.pop()
        (roles if t in ROLE_TOKENS else states).append(t)
    base = " ".join(tokens).rstrip(" -")
    role = "clean" if "Clean" in roles else "simple" if "Simple" in roles else "standard"
    return base, role, " ".join(reversed(states))


def family_title(base: str) -> str:
    """Drop the pack prefix: 'Into the Wilds: Caves 01a Bear's Den' → "Bear's Den";
    'ItW Caves 04 - 01 Storage Room' → 'Storage Room'; 'ItW Caves 02 Combined' → 'Combined'."""
    base = base.replace(" - ", " ")
    m = re.match(r"^.*?\bCaves\s+\d+[a-z]?\s*(\d+\s+)?(.*)$", base)
    if not m:
        return base
    t = m.group(2).strip(" -")
    if t.lower() == "combined" and m.group(1):
        t = f"Combined {m.group(1).strip()}"
    return t or base


def slugify(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def squares_from_filename(image: str) -> list[int] | None:
    m = re.search(r"_(\d+)x(\d+)\.\w+$", image)
    return [int(m.group(1)), int(m.group(2))] if m else None


# --------------------------------------------------------------------------- walls and lights

def scene_origin(doc: dict) -> tuple[int, int]:
    """Where the background image sits on Foundry's padded canvas. Wall and light coordinates
    in a pack are canvas coordinates; the image starts this far in. Foundry rounds the padding
    up to whole squares per side (verified on the Caves packs: 3080×2380 at 0.25 gives 840, 700)."""
    g = grid_size(doc)
    pad = float(doc["padding"]) if doc.get("padding") is not None else 0.25
    return (math.ceil(int(doc.get("width") or 0) * pad / g) * g,
            math.ceil(int(doc.get("height") or 0) * pad / g) * g)


def sidecar_from(doc: dict) -> dict:
    """Foundry-native walls and lights, stripped of pack bookkeeping, translated onto the image's
    own pixel grid (0,0 = the image's top-left). `origin` is what was subtracted; add the target
    scene's own origin back when placing in Foundry."""
    ox, oy = scene_origin(doc)

    def clean(d: dict) -> dict:
        return {k: v for k, v in d.items() if k not in ("_key", "_stats")}

    walls = []
    for w in doc.get("walls", []):
        w = clean(w)
        c = w.get("c") or [0, 0, 0, 0]
        w["c"] = [c[0] - ox, c[1] - oy, c[2] - ox, c[3] - oy]
        walls.append(w)
    lights = []
    for l in doc.get("lights", []):
        l = clean(l)
        l["x"] = l.get("x", 0) - ox
        l["y"] = l.get("y", 0) - oy
        lights.append(l)
    return {
        "name": doc.get("name"),
        "width": doc.get("width"),
        "height": doc.get("height"),
        "grid": grid_size(doc),
        "padding": doc.get("padding"),
        "origin": [ox, oy],
        "walls": walls,
        "lights": lights,
    }


def grid_size(doc: dict) -> int:
    g = doc.get("grid")
    if isinstance(g, dict):
        return int(g.get("size") or 100)
    return int(g or doc.get("gridSize") or 100)


def light_class(light: dict) -> str:
    cfg = light.get("config") or light
    col = (cfg.get("color") or "").lstrip("#")
    if len(col) != 6:
        return "white"
    r, g, b = int(col[0:2], 16), int(col[2:4], 16), int(col[4:6], 16)
    if r > g > b and r - b > 60:
        return "fire"
    if g > r and b > r:
        return "cyan"
    if b > r and b > g:
        return "blue"
    if g > r and g > b:
        return "green"
    if r > b and g > b and abs(r - g) < 50 and r - b > 40:
        return "warm"
    return "white"


# --------------------------------------------------------------------------- image work

def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def floor_mask(rgb: np.ndarray) -> np.ndarray:
    """Floor = not void. Void is the near-black outside a cave, after a blur so texture
    specks in the rock don't count."""
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    grey = cv2.GaussianBlur(grey, (0, 0), VOID_BLUR)
    m = (grey >= VOID_LEVEL).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    return m


def edge_exits(mask: np.ndarray, grid: int) -> list[Exit]:
    """Runs of floor touching each edge of the map, in squares along that edge."""
    h, w = mask.shape
    bands = {
        "N": mask[:EXIT_BAND, :].max(axis=0),
        "S": mask[h - EXIT_BAND:, :].max(axis=0),
        "W": mask[:, :EXIT_BAND].max(axis=1),
        "E": mask[:, w - EXIT_BAND:].max(axis=1),
    }
    out = []
    for edge, line in bands.items():
        on = line > 0
        i = 0
        n = len(on)
        while i < n:
            if on[i]:
                j = i
                while j < n and on[j]:
                    j += 1
                if (j - i) / grid >= EXIT_MIN_SQUARES:
                    out.append(Exit(edge, round(i / grid, 2), round(j / grid, 2)))
                i = j
            else:
                i += 1
    return out


def walkable_exits(mask: np.ndarray, walls: list[dict], grid: int) -> list[Exit]:
    """Exits a token could walk through: the walled-in interior floor where it touches the map
    edge. Walls (doors excluded) are drawn as barriers on the floor mask, the biggest connected
    floor region is the interior, and only its contact with the edge counts. The rock rim that
    the painting carries to the map edge is outside the walls and so never reads as an exit."""
    m = (mask > 0).astype(np.uint8)
    for w in walls:
        if w.get("door"):
            continue
        c = w["c"]
        cv2.line(m, (int(c[0]), int(c[1])), (int(c[2]), int(c[3])), 0, 5)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return []
    # Interior = the floor regions big enough to matter (at least 4 squares); a map can have
    # more than one walled-in area, each with its own exits.
    keep = {i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 4 * grid * grid}
    interior = np.isin(labels, list(keep)).astype(np.uint8) * 255
    return edge_exits(interior, grid)


def lift_props(std: np.ndarray, clean: np.ndarray, grid: int, dest: Path, slug: str) -> list[Prop]:
    """Props are what the standard map has and the Clean one hasn't. Filled contours, so pale
    props don't get holes. Each is saved RGBA with a feathered alpha."""
    d = np.abs(std.astype(np.int16) - clean.astype(np.int16)).max(axis=2).astype(np.uint8)
    m = (d > PROP_DIFF).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted((c for c in contours if cv2.contourArea(c) > PROP_MIN_AREA),
                      key=cv2.contourArea, reverse=True)[:PROP_MAX]
    dest.mkdir(parents=True, exist_ok=True)
    props = []
    for i, c in enumerate(contours):
        x, y, w, h = cv2.boundingRect(c)
        pad = 6
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(std.shape[1], x + w + pad), min(std.shape[0], y + h + pad)
        alpha = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.drawContours(alpha, [c - [x0, y0]], -1, 255, -1)
        alpha = cv2.GaussianBlur(alpha, (0, 0), 1.5)
        rgba = np.dstack([std[y0:y1, x0:x1], alpha])
        name = f"{slug}-{i + 1:02d}.png"
        Image.fromarray(rgba).save(dest / name)
        props.append(Prop(
            file=name,
            box=[int(x0), int(y0), int(x1), int(y1)],
            footprint=[round(max(0.5, round((x1 - x0) / grid * 2) / 2), 1),
                       round(max(0.5, round((y1 - y0) / grid * 2) / 2), 1)],
            area=int(cv2.contourArea(c)),
        ))
    return props


def draw_check(rgb: np.ndarray, sidecar: dict, out: Path, scale: float = 0.25) -> None:
    """The standard map at quarter size with walls (white), doors (orange), lights (circles)."""
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    img = Image.fromarray(small)
    dr = ImageDraw.Draw(img)
    for w in sidecar["walls"]:
        x0, y0, x1, y1 = [v * scale for v in w["c"]]
        door = w.get("door", 0)
        colour = (255, 140, 0) if door else (255, 255, 255)
        dr.line([(x0, y0), (x1, y1)], fill=colour, width=3 if door else 2)
    for l in sidecar["lights"]:
        cfg = l.get("config") or l
        g = sidecar["grid"] * scale
        r = float(cfg.get("dim") or l.get("dim") or 0) / 5 * g
        x, y = l["x"] * scale, l["y"] * scale
        col = "#" + ((cfg.get("color") or "ffffff").lstrip("#"))
        try:
            dr.ellipse([x - r, y - r, x + r, y + r], outline=col, width=2)
        except ValueError:
            dr.ellipse([x - r, y - r, x + r, y + r], outline="white", width=2)
        dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=col if len(col) == 7 else "white")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=88)


def contact_sheet(families: list[Family], thumbs_dir: Path, out: Path) -> None:
    cards = [f for f in families if f.thumb]
    if not cards:
        return
    cols = 3
    rows = (len(cards) + cols - 1) // cols
    card_h = int(CONTACT_W * 0.78) + 44
    sheet = Image.new("RGB", (cols * (CONTACT_W + 16) + 16, rows * (card_h + 16) + 16), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    for i, fam in enumerate(cards):
        x = 16 + (i % cols) * (CONTACT_W + 16)
        y = 16 + (i // cols) * (card_h + 16)
        th = Image.open(thumbs_dir / Path(fam.thumb).name).convert("RGB")
        th.thumbnail((CONTACT_W, card_h - 44))
        sheet.paste(th, (x, y))
        label = f"{fam.title}  {fam.squares[0]}x{fam.squares[1]}  exits {len(fam.exits)}  lights {fam.lights}  doors {fam.doors}  props {len(fam.props)}"
        dr.text((x, y + card_h - 40), label[:70], fill=(230, 230, 230), font=font)
        dr.text((x, y + card_h - 20), fam.slug, fill=(160, 160, 160), font=font)
    sheet.save(out, quality=85)


# --------------------------------------------------------------------------- Combined sheets

def tile_combined(fam: Family, singles: list[Family], mod_dir: Path, scenes: dict[str, dict]) -> dict:
    """Cut a Combined sheet into single-map cells and match each to a single family by art.
    Returns {"tiles": [{col,row,family,score}], "adjacency": [[a, edgeOfA, b]]}."""
    std = next((s for s in fam.scenes if s.role == "standard"), None) or fam.scenes[0]
    single_sq = None
    for s in singles:
        if not s.combined:
            single_sq = s.squares
            break
    if not std or not single_sq:
        return {"tiles": [], "adjacency": []}
    cols = fam.squares[0] // single_sq[0]
    rows = fam.squares[1] // single_sq[1]
    if cols * rows < 2 or cols * single_sq[0] != fam.squares[0] or rows * single_sq[1] != fam.squares[1]:
        return {"tiles": [], "adjacency": []}
    sheet = load_rgb(mod_dir / std.image)
    ch, cw = sheet.shape[0] // rows, sheet.shape[1] // cols
    small = (110, 85)
    refs = []
    for s in singles:
        if s.combined:
            continue
        # match on the same role and state as the sheet when possible, else any
        pick = next((x for x in s.scenes if x.role == std.role and x.state == std.state), None) \
            or next((x for x in s.scenes if x.role == std.role), None) or s.scenes[0]
        refs.append((s.slug, cv2.resize(load_rgb(mod_dir / pick.image), small, interpolation=cv2.INTER_AREA).astype(np.float32)))
    tiles = []
    grid: dict[tuple[int, int], str] = {}
    for r in range(rows):
        for c in range(cols):
            cell = sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            cell = cv2.resize(cell, small, interpolation=cv2.INTER_AREA).astype(np.float32)
            best = min(((float(np.abs(cell - ref).mean()), slug) for slug, ref in refs), default=(999.0, None))
            score, slug = best
            if slug is not None and score <= TILE_MATCH_MAX:
                tiles.append({"col": c, "row": r, "family": slug, "score": round(score, 2)})
                grid[(c, r)] = slug
            else:
                tiles.append({"col": c, "row": r, "family": None, "score": round(score, 2)})
    adjacency = []
    for (c, r), a in grid.items():
        if (c + 1, r) in grid:
            adjacency.append([a, "E", grid[(c + 1, r)]])
        if (c, r + 1) in grid:
            adjacency.append([a, "S", grid[(c, r + 1)]])
    return {"tiles": tiles, "adjacency": adjacency}


# --------------------------------------------------------------------------- the module pass

def catalogue_module(mod_dir: Path, out: Path, node: str, props: bool) -> dict:
    manifest = read_module(mod_dir)
    module_id = manifest.get("id") or manifest.get("name") or mod_dir.name
    docs = read_scenes(mod_dir, manifest, node)
    scenes_dir = out / "scenes" / module_id
    scenes_dir.mkdir(parents=True, exist_ok=True)

    families: dict[str, Family] = {}
    docs_by_id: dict[str, dict] = {}
    for doc in docs:
        image = scene_image(mod_dir, module_id, doc)
        if not image:
            print(f"  skip {doc.get('name')!r}: background image not found", file=sys.stderr)
            continue
        base, role, state = split_name(doc["name"])
        title = family_title(base)
        slug = slugify(title)
        side = sidecar_from(doc)
        sidecar_rel = f"scenes/{module_id}/{doc['_id']}.json"
        with open(out / sidecar_rel, "w", encoding="utf-8") as f:
            json.dump(side, f)
        docs_by_id[doc["_id"]] = doc
        sc = Scene(
            id=doc["_id"], name=doc["name"], image=image,
            width=int(doc.get("width") or 0), height=int(doc.get("height") or 0),
            grid=side["grid"], role=role, state=state,
            walls=len(side["walls"]), doors=sum(1 for w in side["walls"] if w.get("door")),
            lights=len(side["lights"]), tiles=len(doc.get("tiles") or []), sidecar=sidecar_rel,
        )
        if slug not in families:
            sq = squares_from_filename(image) or [round(sc.width / sc.grid), round(sc.height / sc.grid)]
            families[slug] = Family(slug=slug, title=title, squares=sq, combined="combined" in slug)
        families[slug].scenes.append(sc)

    fam_list = sorted(families.values(), key=lambda f: (f.combined, f.slug))
    for fam in fam_list:
        fam.scenes.sort(key=lambda s: (s.state, {"standard": 0, "clean": 1, "simple": 2}[s.role]))
        # The representative: the standard variant with the most lights (the "open" state usually).
        std = max((s for s in fam.scenes if s.role == "standard"), key=lambda s: s.lights, default=fam.scenes[0])
        fam.lights, fam.doors = std.lights, std.doors
        side = sidecar_from(docs_by_id[std.id])
        classes: dict[str, int] = {}
        for l in side["lights"]:
            k = light_class(l)
            classes[k] = classes.get(k, 0) + 1
        fam.light_classes = classes

        rgb = load_rgb(mod_dir / std.image)
        grid = std.grid
        mask = floor_mask(rgb)
        fam.floor_fraction = round(float((mask > 0).mean()), 3)
        fam.exits = edge_exits(mask, grid)
        (out / "masks" / module_id).mkdir(parents=True, exist_ok=True)
        fam.mask = f"masks/{module_id}/{fam.slug}.png"
        Image.fromarray(cv2.resize(mask, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)).save(out / fam.mask)

        (out / "thumbs" / module_id).mkdir(parents=True, exist_ok=True)
        fam.thumb = f"thumbs/{module_id}/{fam.slug}.jpg"
        th = Image.fromarray(rgb)
        th.thumbnail((THUMB_W, THUMB_W))
        th.save(out / fam.thumb, quality=85)

        fam.check = f"check/{module_id}/{fam.slug}.jpg"
        draw_check(rgb, side, out / fam.check)

        if props and not fam.combined:
            clean = next((s for s in fam.scenes if s.role == "clean" and s.state == std.state), None) \
                or next((s for s in fam.scenes if s.role == "clean"), None)
            if clean:
                crgb = load_rgb(mod_dir / clean.image)
                if crgb.shape == rgb.shape:
                    fam.props = lift_props(rgb, crgb, grid, out / "props" / module_id, fam.slug)

    combined = {}
    singles = [f for f in fam_list if not f.combined]
    for fam in fam_list:
        if fam.combined:
            combined[fam.slug] = tile_combined(fam, singles, mod_dir, docs_by_id)

    contact_sheet(fam_list, out / "thumbs" / module_id, out / f"contact-{module_id}.jpg")

    record = {
        "module": module_id,
        "title": manifest.get("title"),
        "version": manifest.get("version"),
        "path": str(mod_dir),
        "grid": fam_list[0].scenes[0].grid if fam_list else None,
        "families": [asdict(f) for f in fam_list],
        "combined": combined,
    }
    with open(out / f"{module_id}.json", "w", encoding="utf-8") as f:
        json.dump(record, f, indent=1)
    return record


def write_index(out: Path) -> None:
    entries = []
    for p in sorted(out.glob("*.json")):
        if p.name == "index.json":
            continue
        with open(p, encoding="utf-8") as f:
            rec = json.load(f)
        for fam in rec["families"]:
            entries.append({
                "module": rec["module"],
                "slug": fam["slug"],
                "title": fam["title"],
                "squares": fam["squares"],
                "combined": fam["combined"],
                "variants": sorted({f"{s['role']}{(' ' + s['state']) if s['state'] else ''}" for s in fam["scenes"]}),
                "exits": [[e["edge"], e["start"], e["end"]] for e in fam["exits"]],
                "lights": fam["lights"],
                "light_classes": fam["light_classes"],
                "doors": fam["doors"],
                "props": len(fam["props"]),
                "floor": fam["floor_fraction"],
                "thumb": fam["thumb"],
                "tags": fam["tags"],
            })
    with open(out / "index.json", "w", encoding="utf-8") as f:
        json.dump({"root": str(out.parent), "families": entries}, f, indent=1)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--no-props", action="store_true")
    ap.add_argument("--node", default="node")
    a = ap.parse_args(argv)
    out = a.out or (a.root / "_catalogue")
    out.mkdir(parents=True, exist_ok=True)
    mods = [d for d in sorted(a.root.iterdir()) if (d / "module.json").is_file()]
    if a.only:
        mods = [d for d in mods if d.name in a.only]
    for d in mods:
        print(f"== {d.name}")
        rec = catalogue_module(d, out, a.node, not a.no_props)
        for fam in rec["families"]:
            print(f"  {fam['slug']:<28} {fam['squares'][0]}x{fam['squares'][1]:<3} scenes {len(fam['scenes']):<2} "
                  f"exits {len(fam['exits'])} lights {fam['lights']:<3} doors {fam['doors']:<2} props {len(fam['props'])}")
        for slug, c in rec["combined"].items():
            print(f"  {slug}: tiles {[t['family'] for t in c['tiles']]}")
    write_index(out)
    print(f"index: {out / 'index.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
