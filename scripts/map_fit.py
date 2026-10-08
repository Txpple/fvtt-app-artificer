#!/usr/bin/env python
"""Fit a map's carried walls and lights to its repainted version (map-builder stage C).

    python map_fit.py SOURCE SIDECAR RESULT OUT_STEM [--tolerance 0.3] [--search 0.6]

SOURCE   the original map image the repaint was made from
SIDECAR  its walls/lights JSON from map_library.py (image pixel coordinates)
RESULT   the repaint, on the source's pixel grid at a whole-number scale (imagegen battlemap)
OUT_STEM writes OUT_STEM.fitted.json, OUT_STEM.overlay.jpg, OUT_STEM.report.json

What it does, deterministically:
  1. walls in → walls out: scales every coordinate by RESULT/SOURCE (the delivery scale)
  2. floor masks of source and result (void threshold after a blur); IoU and void darkness
  3. snap: for every wall vertex, the structure around it in the source (an edge-strength
     patch about 0.7 squares wide) is located in the result by normalised cross-correlation
     within ±--search squares, and the vertex follows it when it moved at most --tolerance
     squares. A segment that moved more is a MOVER: kept where it was and flagged for eyes.
     A vertex with no structure around it (flat void, flat floor) is carried unchanged.
  4. glow pass: warm, cyan and white glows in the result that no carried light covers become new
     lights, coloured from the pixels.
  5. overlay: result at quarter size with walls white, movers red, doors orange, lights as
     circles, new lights dashed, edge exits as blue bands.

Nothing here refuses. The report says how much moved; the caller decides.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
sys.path.insert(0, str(Path(__file__).resolve().parent))
from map_library import VOID_BLUR, VOID_LEVEL, edge_exits, floor_mask, light_class, load_rgb  # noqa: E402

ON_EDGE_PX = 6          # a source vertex this close to the source floor edge is an edge vertex
GLOW_MIN_AREA_SQ = 0.15 # squares²; smaller bright blobs are specks


def floor_edge(mask: np.ndarray) -> np.ndarray:
    k = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, k)


def nearest_edge(edge: np.ndarray, x: float, y: float, r: int) -> tuple[float, float, float] | None:
    h, w = edge.shape
    x0, y0 = int(max(0, x - r)), int(max(0, y - r))
    x1, y1 = int(min(w, x + r + 1)), int(min(h, y + r + 1))
    win = edge[y0:y1, x0:x1]
    ys, xs = np.nonzero(win)
    if len(xs) == 0:
        return None
    d = np.hypot(xs + x0 - x, ys + y0 - y)
    i = int(d.argmin())
    return float(xs[i] + x0), float(ys[i] + y0), float(d[i])


def edge_strength(rgb: np.ndarray) -> np.ndarray:
    """Structure, not paint: Sobel magnitude of the blurred luminance, as float32 0..1."""
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    grey = cv2.GaussianBlur(grey, (0, 0), 2.0)
    gx = cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    hi = float(np.percentile(mag, 99.5)) or 1.0
    return np.clip(mag / hi, 0, 1)


def locate_vertex(src_e: np.ndarray, res_e: np.ndarray, x: int, y: int, patch: int, search: int
                  ) -> tuple[float, float, float]:
    """Where did the structure around (x, y) land in the result? Normalised cross-correlation of
    the source's edge-strength patch against the result within ±search px. Returns (dx, dy, score).
    A patch without structure (flat void, flat floor) scores low and is left where it was."""
    h, w = src_e.shape
    half = patch // 2
    if x - half < 0 or y - half < 0 or x + half >= w or y + half >= h:
        return 0.0, 0.0, 0.0
    tpl = src_e[y - half:y + half, x - half:x + half]
    if tpl.std() < 0.04:
        return 0.0, 0.0, 0.0
    x0, y0 = max(0, x - half - search), max(0, y - half - search)
    x1, y1 = min(w, x + half + search), min(h, y + half + search)
    win = res_e[y0:y1, x0:x1]
    if win.shape[0] < tpl.shape[0] or win.shape[1] < tpl.shape[1]:
        return 0.0, 0.0, 0.0
    cc = cv2.matchTemplate(win, tpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(cc)
    dx = (loc[0] + x0 + half) - x
    dy = (loc[1] + y0 + half) - y
    return float(dx), float(dy), float(score)


MATCH_MIN = 0.35        # correlation below this is noise: the vertex is carried unchanged


def snap_walls(walls: list[dict], src_e: np.ndarray, res_e: np.ndarray, grid: float,
               tolerance: float, search: float) -> tuple[list[dict], list[dict], dict]:
    tol_px, search_px, patch = tolerance * grid, int(search * grid), int(round(0.7 * grid)) // 2 * 2
    fitted, movers = [], []
    # Shared vertices move together: locate by vertex key, not per wall.
    cache: dict[tuple[int, int], tuple[float, float, float]] = {}

    def locate(x: int, y: int) -> tuple[float, float, float]:
        key = (x, y)
        if key not in cache:
            cache[key] = locate_vertex(src_e, res_e, x, y, patch, search_px)
        return cache[key]

    for w in walls:
        locate(w["c"][0], w["c"][1])
        locate(w["c"][2], w["c"][3])

    # Walls that share vertices form a component: a cave perimeter, a room, a prop outline.
    parent: dict[tuple[int, int], tuple[int, int]] = {k: k for k in cache}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for w in walls:
        a, b = (w["c"][0], w["c"][1]), (w["c"][2], w["c"][3])
        parent[find(a)] = find(b)
    comps: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for k in cache:
        comps.setdefault(find(k), []).append(k)

    # Each vertex's displacement: a small component (a prop, a pillar) moves rigidly by the
    # median of its located vertices; a big one (the cave rim) moves per vertex, smoothed by its
    # neighbours so one bad match cannot kink the wall.
    neighbours: dict[tuple[int, int], list[tuple[int, int]]] = {k: [] for k in cache}
    for w in walls:
        a, b = (w["c"][0], w["c"][1]), (w["c"][2], w["c"][3])
        neighbours[a].append(b)
        neighbours[b].append(a)
    disp: dict[tuple[int, int], tuple[float, float] | None] = {}
    for members in comps.values():
        xs = [m[0] for m in members]
        ys = [m[1] for m in members]
        located = [cache[m] for m in members if cache[m][2] >= MATCH_MIN]
        small = max(max(xs) - min(xs), max(ys) - min(ys)) < 2.5 * grid
        if small:
            if located:
                d = (float(np.median([v[0] for v in located])), float(np.median([v[1] for v in located])))
            else:
                d = None
            for m in members:
                disp[m] = d
        else:
            for m in members:
                v = cache[m]
                near = [cache[n] for n in neighbours[m] if cache[n][2] >= MATCH_MIN]
                if v[2] >= MATCH_MIN:
                    if near:
                        mx, my = float(np.median([n[0] for n in near])), float(np.median([n[1] for n in near]))
                        if math.hypot(v[0] - mx, v[1] - my) > 0.25 * grid:
                            disp[m] = (mx, my)       # an outlier against its neighbours
                            continue
                    disp[m] = (v[0], v[1])
                elif near:
                    disp[m] = (float(np.median([n[0] for n in near])), float(np.median([n[1] for n in near])))
                else:
                    disp[m] = None

    for w in walls:
        c = w["c"]
        a, b = (c[0], c[1]), (c[2], c[3])
        da, db = disp.get(a), disp.get(b)
        out = dict(w)
        ma = math.hypot(*da) if da else 0.0
        mb = math.hypot(*db) if db else 0.0
        moved = max(ma, mb)
        if moved > search_px:
            # Beyond the search window the match is a guess: carry the wall and flag it.
            movers.append({"c": c, "door": w.get("door", 0), "moved_px": round(moved, 1)})
            fitted.append(out)
            continue
        out["c"] = [int(round(c[0] + (da[0] if da else 0))), int(round(c[1] + (da[1] if da else 0))),
                    int(round(c[2] + (db[0] if db else 0))), int(round(c[3] + (db[1] if db else 0)))]
        if da or db:
            out["moved_px"] = round(moved, 1)
        if moved > tol_px:
            # Followed the paint, but further than the tolerance: snapped AND flagged for eyes.
            movers.append({"c": out["c"], "door": w.get("door", 0), "moved_px": round(moved, 1)})
        fitted.append(out)
    scores = np.array([v[2] for v in cache.values()])
    stats = {
        "vertices": len(cache),
        "vertices_located": int((scores >= MATCH_MIN).sum()),
        "match_median": round(float(np.median(scores)), 3) if len(scores) else 0.0,
    }
    return fitted, movers, stats


def find_glows(rgb: np.ndarray, grid: float, lights: list[dict]) -> list[dict]:
    """Bright saturated or white blobs in the painting with no carried light within their reach."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    warm = ((h < 25) | (h > 165)) & (s > 110) & (v > 170)
    cyan = (h > 75) & (h < 110) & (s > 70) & (v > 150)
    white = (s < 40) & (v > 235)
    classes = {"fire": warm, "cyan": cyan, "daylight": white}
    radius = {"fire": (20, 40), "cyan": (0, 10), "daylight": (15, 30)}
    found = []
    for name, m in classes.items():
        m8 = m.astype(np.uint8) * 255
        m8 = cv2.morphologyEx(m8, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n, _, stats, cents = cv2.connectedComponentsWithStats(m8)
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if area < GLOW_MIN_AREA_SQ * grid * grid:
                continue
            cx, cy = float(cents[i][0]), float(cents[i][1])
            covered = any(math.hypot(l["x"] - cx, l["y"] - cy) < 2.0 * grid for l in lights)
            if covered:
                continue
            x0, y0, w, hh = [int(stats[i][k]) for k in (cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT)]
            px = rgb[y0:y0 + hh, x0:x0 + w][m[y0:y0 + hh, x0:x0 + w]]
            col = px.mean(axis=0).astype(int) if len(px) else np.array([255, 255, 255])
            bright, dim = radius[name]
            found.append({
                "x": int(cx), "y": int(cy), "rotation": 0, "walls": True, "vision": False,
                "config": {"alpha": 0.4, "angle": 360, "bright": bright, "dim": dim,
                           "color": "#%02x%02x%02x" % tuple(col), "coloration": 1,
                           "attenuation": 0.5, "luminosity": 0.5,
                           "animation": {"type": "torch" if name == "fire" else None, "speed": 3, "intensity": 3}},
                "hidden": False, "flags": {"map-builder": {"found": name, "area_px": int(area)}},
            })
    return found


def draw_overlay(rgb: np.ndarray, walls: list[dict], movers: list[dict], lights: list[dict],
                 new_lights: list[dict], exits: list, grid: float, out: Path, scale: float = 0.25) -> None:
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    img = Image.fromarray(small)
    dr = ImageDraw.Draw(img)
    W, H = img.size
    for e in exits:
        a, b = e.start * grid * scale, e.end * grid * scale
        band = 6
        box = {"N": [a, 0, b, band], "S": [a, H - band, b, H], "W": [0, a, band, b], "E": [W - band, a, W, b]}[e.edge]
        dr.rectangle(box, fill=(60, 140, 255))
    mover_keys = {tuple(m["c"]) for m in movers}
    for w in walls:
        x0, y0, x1, y1 = [v * scale for v in w["c"]]
        if tuple(w["c"]) in mover_keys:
            colour, width = (255, 40, 40), 4
        elif w.get("door"):
            colour, width = (255, 140, 0), 3
        else:
            colour, width = (255, 255, 255), 2
        dr.line([(x0, y0), (x1, y1)], fill=colour, width=width)
    for l, new in [(l, False) for l in lights] + [(l, True) for l in new_lights]:
        cfg = l.get("config") or l
        r = float(cfg.get("dim") or 0) / 5 * grid * scale
        x, y = l["x"] * scale, l["y"] * scale
        col = "#" + (cfg.get("color") or "ffffff").lstrip("#")
        if len(col) != 7:
            col = "#ffffff"
        if new:
            for ang in range(0, 360, 30):
                dr.arc([x - r, y - r, x + r, y + r], ang, ang + 15, fill=col, width=1)
            dr.ellipse([x - 9, y - 9, x + 9, y + 9], outline=col, width=3)
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col)
        else:
            dr.ellipse([x - r, y - r, x + r, y + r], outline=col, width=2)
            dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=col)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=88)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path)
    ap.add_argument("sidecar", type=Path)
    ap.add_argument("result", type=Path)
    ap.add_argument("out_stem", type=Path)
    ap.add_argument("--tolerance", type=float, default=0.3, help="squares a vertex may be snapped")
    ap.add_argument("--search", type=float, default=0.6, help="squares to look for a floor edge")
    a = ap.parse_args(argv)

    src = load_rgb(a.source)
    res = load_rgb(a.result)
    with open(a.sidecar, encoding="utf-8") as f:
        side = json.load(f)
    k = res.shape[1] / src.shape[1]
    if abs(k - round(k)) > 1e-6 or abs(res.shape[0] / src.shape[0] - k) > 1e-6:
        print(f"result is not a whole-number scale of the source ({k:.4f})", file=sys.stderr)
        return 2
    k = int(round(k))
    grid = side["grid"] * k

    # 1. walls in → walls out
    walls = [dict(w, c=[v * k for v in w["c"]]) for w in side["walls"]]
    lights = [dict(l, x=l["x"] * k, y=l["y"] * k) for l in side["lights"]]

    # 2. masks and scores
    src_mask = floor_mask(src)
    if k != 1:
        src_mask = cv2.resize(src_mask, (res.shape[1], res.shape[0]), interpolation=cv2.INTER_NEAREST)
    res_mask = floor_mask(res)
    inter = np.logical_and(src_mask > 0, res_mask > 0).sum()
    union = np.logical_or(src_mask > 0, res_mask > 0).sum()
    iou = float(inter / union) if union else 0.0
    void_px = res[src_mask == 0]
    void_dark = float((void_px.max(axis=1) < VOID_LEVEL).mean()) if len(void_px) else 1.0
    extra = np.logical_and(res_mask > 0, src_mask == 0).astype(np.uint8)
    missing = np.logical_and(src_mask > 0, res_mask == 0).astype(np.uint8)

    def biggest_blob(m: np.ndarray) -> float:
        n, _, stats, _ = cv2.connectedComponentsWithStats(m)
        return float(stats[1:, cv2.CC_STAT_AREA].max() / (grid * grid)) if n > 1 else 0.0

    # 3. snap
    src_for_edges = src if k == 1 else cv2.resize(src, (res.shape[1], res.shape[0]), interpolation=cv2.INTER_CUBIC)
    fitted, movers, vstats = snap_walls(walls, edge_strength(src_for_edges), edge_strength(res), grid, a.tolerance, a.search)
    moved = [w["moved_px"] for w in fitted if "moved_px" in w]

    # 4. glows
    new_lights = find_glows(res, grid, lights)

    # 5. overlay and files
    exits = edge_exits(res_mask, grid)
    draw_overlay(res, fitted, movers, lights, new_lights, exits, grid, Path(str(a.out_stem) + ".overlay.jpg"))
    out_side = {
        "source": str(a.source), "result": str(a.result), "scale": k, "grid": grid,
        "width": res.shape[1], "height": res.shape[0],
        "walls": [{kk: v for kk, v in w.items() if kk != "moved_px"} for w in fitted],
        "lights": lights + new_lights,
        "exits": [[e.edge, e.start, e.end] for e in exits],
    }
    with open(str(a.out_stem) + ".fitted.json", "w", encoding="utf-8") as f:
        json.dump(out_side, f)
    report = {
        "scale": k,
        "floor_iou": round(iou, 4),
        "void_dark": round(void_dark, 4),
        "extra_floor_biggest_sq": round(biggest_blob(extra), 2),
        "missing_floor_biggest_sq": round(biggest_blob(missing), 2),
        "walls": len(fitted),
        **vstats,
        "walls_snapped": len(moved),
        "snap_median_px": round(float(np.median(moved)), 1) if moved else 0.0,
        "snap_p90_px": round(float(np.percentile(moved, 90)), 1) if moved else 0.0,
        "movers": len(movers),
        "mover_share": round(len(movers) / max(1, len(fitted)), 4),
        "lights_carried": len(lights),
        "lights_found": len(new_lights),
        "exits": [[e.edge, e.start, e.end] for e in exits],
    }
    with open(str(a.out_stem) + ".report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
