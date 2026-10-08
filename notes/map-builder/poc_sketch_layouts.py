"""Draw the Hearth battlemap layouts (POC: Great Hall, Goat ledges, the Door).

Each map is 22x17 squares at 140 px (3080x2380), the Tom Cartos sheet size, drawn as a
half-painted sketch (shaded floor, black void, rock rim, glow halo) for imagegen to restyle.
Exits sit at fixed grid positions so linked maps line up for teleporter regions; they are
written to exits.json.

    python scripts/hearth-layouts.py [out_dir]
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 140                      # px per 5-ft square
GW, GH = 22, 17              # grid squares
W, H = GW * S, GH * S
LO = 4                       # low-res factor for the organic cave field
RNG = np.random.default_rng(1391)


# ---------- noise and masks ----------

def noise(scale_sq, octaves=3, seed=None):
    """Value noise in 0..1 at full res; scale_sq = feature size in squares."""
    rng = np.random.default_rng(seed) if seed is not None else RNG
    out = np.zeros((H, W), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cell = max(1, int(scale_sq * S / (2 ** o)))
        gw, gh = W // cell + 2, H // cell + 2
        g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
        g = g.resize((gw * cell, gh * cell), Image.BICUBIC).crop((0, 0, W, H))
        out += amp * np.asarray(g, np.float32) / 255
        total += amp
        amp *= 0.5
    return out / total


def blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), np.float32) / 255


def px(x, y):
    return x * S, y * S


class Layout:
    """Shapes in grid units -> organic cave mask + exact (worked) areas."""

    def __init__(self, name, seed):
        self.name = name
        self.seed = seed
        self.lo = Image.new("L", (W // LO, H // LO), 0)
        self.ld = ImageDraw.Draw(self.lo)
        self.exact = Image.new("L", (W, H), 0)      # straight-edged floor (cut stone, exits)
        self.ed = ImageDraw.Draw(self.exact)
        self.exits = []

    # organic shapes (low-res, later blurred + noised)
    def blob(self, cx, cy, rx, ry):
        k = S / LO
        self.ld.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=255)

    def tunnel(self, pts, width):
        k = S / LO
        p = [(x * k, y * k) for x, y in pts]
        self.ld.line(p, fill=255, width=int(width * k))
        for x, y in p:
            r = width * k / 2
            self.ld.ellipse([x - r, y - r, x + r, y + r], fill=255)

    # exact shapes (full res)
    def rect(self, x0, y0, x1, y1):
        self.ed.rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], fill=255)

    def exit(self, name, edge, a, b, to_map, to_exit, depth=2.5):
        """An exit `a`..`b` squares along `edge`, cut square to the map edge."""
        if edge == "W":
            self.rect(0, a, depth, b); reg = (0, a, 1, b)
        elif edge == "E":
            self.rect(GW - depth, a, GW, b); reg = (GW - 1, a, GW, b)
        elif edge == "N":
            self.rect(a, 0, b, depth); reg = (a, 0, b, 1)
        else:
            self.rect(a, GH - depth, b, GH); reg = (a, GH - 1, b, GH)
        self.exits.append({
            "name": name, "edge": edge, "to": to_map, "toExit": to_exit,
            "region": {"grid": dict(zip(("x0", "y0", "x1", "y1"), reg)),
                       "px": {"x": reg[0] * S, "y": reg[1] * S,
                              "width": (reg[2] - reg[0]) * S, "height": (reg[3] - reg[1]) * S}},
        })

    def floor(self):
        f = np.asarray(self.lo.filter(ImageFilter.GaussianBlur(S / LO * 0.7)), np.float32) / 255
        f = np.asarray(Image.fromarray((f * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC),
                       np.float32) / 255
        n = noise(1.6, 4, seed=self.seed) - 0.5
        organic = (f + n * 0.55) > 0.5
        exact = np.asarray(self.exact) > 127
        m = (organic | exact).astype(np.float32)
        # drop specks of floor that broke off the main cave
        m = (blur(m, 6) > 0.5).astype(np.float32)
        self.floor_mask = m
        return m


# ---------- painting ----------

def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def col(rgb):
    return np.array(rgb, np.float32).reshape(1, 1, 3)


def paint(floor, paved, water, seed):
    """Base painting: void, glow halo, rock rim, earthen floor, flagstones, water."""
    n1 = noise(0.5, 4, seed=seed + 1)
    n2 = noise(0.12, 3, seed=seed + 2)
    tex = (n1 * 0.6 + n2 * 0.4)[..., None]

    img = np.zeros((H, W, 3), np.float32) + col((10, 10, 12))
    void = 1 - floor
    halo = blur(floor, 70) * void
    img = mix(img, col((92, 88, 84)), np.clip(halo * 1.6, 0, 1) * 0.55)

    # rock rim: a band just outside the floor
    rim = np.clip((blur(floor, 34) - 0.04) * 4, 0, 1) * void
    rock = col((112, 106, 100)) * (0.6 + 0.8 * tex)
    img = mix(img, rock, rim)
    edge = np.clip((blur(floor, 4) - 0.15) * 3, 0, 1) * void
    img = mix(img, col((40, 36, 34)), edge * 0.8)

    # earthen floor, darker near the walls
    inner = blur(floor, 45)
    dirt = col((122, 101, 78)) * (0.78 + 0.45 * tex)
    dirt = dirt * (0.55 + 0.45 * np.clip(inner * 1.3, 0, 1))[..., None]
    img = mix(img, dirt, floor)

    # flagstones
    if paved is not None:
        p = paved
        shade, lines = flagstones(seed)
        stone = col((128, 124, 116)) * (0.85 + 0.3 * tex) * (0.82 + 0.3 * shade)[..., None]
        img = mix(img, stone, p * floor)
        img = mix(img, col((66, 62, 58)), lines * p * floor * 0.8)

    if water is not None:
        w = water * floor
        deep = blur(water, 35)
        wc = mix(col((88, 140, 128)), col((40, 82, 84)), np.clip(deep * 1.4 - 0.3, 0, 1))
        wc = wc * (0.92 + 0.16 * n1[..., None])
        img = mix(img, wc, w)
        shore = np.clip(blur(water, 6) * 2, 0, 1) * (1 - water) * floor
        img = mix(img, col((92, 86, 72)), shore * 0.6)
    return img


def flagstones(seed):
    """Hand-cut slabs of uneven size in staggered courses, so no joint lines up with the grid."""
    rr = np.random.default_rng(seed + 7)
    shade = Image.new("L", (W, H), 128)
    lines = Image.new("L", (W, H), 0)
    ds, dl = ImageDraw.Draw(shade), ImageDraw.Draw(lines)
    y = -rr.random() * 60
    while y < H:
        h = rr.uniform(0.42, 0.78) * S
        x = -rr.random() * 120
        while x < W:
            w = rr.uniform(0.5, 1.15) * S
            j = rr.uniform(-6, 6, 4)
            box = [x + j[0], y + j[1], x + w + j[2], y + h + j[3]]
            ds.rectangle(box, fill=int(rr.uniform(70, 190)))
            dl.rectangle(box, outline=255, width=4)
            x += w
        y += h
    sh = np.asarray(shade.filter(ImageFilter.GaussianBlur(2)), np.float32) / 255
    ln = np.asarray(lines.filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255
    return sh, np.clip(ln * 1.6, 0, 1)


def dress(d, free, seed, pebbles=110, cracks=14):
    """Scatter pebbles and floor cracks over bare earth (`free` is a 0..1 mask)."""
    rr = np.random.default_rng(seed + 3)
    def ok(x, y):
        xi, yi = int(x * S), int(y * S)
        return 0 <= xi < W and 0 <= yi < H and free[yi, xi] > 0.5
    n = 0
    while n < cracks:
        x, y = rr.uniform(0, GW), rr.uniform(0, GH)
        if not ok(x, y):
            continue
        pts, a = [(x, y)], rr.uniform(0, 6.28)
        for _ in range(rr.integers(4, 9)):
            a += rr.uniform(-0.7, 0.7)
            x, y = x + 0.35 * math.cos(a), y + 0.35 * math.sin(a)
            if not ok(x, y):
                break
            pts.append((x, y))
        if len(pts) > 2:
            d.line([tuple(G(*p)) for p in pts], fill=(58, 46, 36), width=5, joint="curve")
            n += 1
    n = 0
    while n < pebbles:
        x, y = rr.uniform(0, GW), rr.uniform(0, GH)
        if not ok(x, y):
            continue
        r = rr.uniform(0.05, 0.16)
        g = int(rr.uniform(105, 150))
        d.ellipse(G(x - r, y - r * 0.8, x + r, y + r * 0.8), fill=(g, g - 6, g - 12), outline=(50, 44, 40), width=4)
        n += 1


def hay(d, cx, cy, r, seed):
    rr = np.random.default_rng(seed)
    d.ellipse(G(cx - r, cy - r * 0.85, cx + r, cy + r * 0.85), fill=(150, 124, 70))
    for _ in range(260):
        a, q = rr.uniform(0, 6.28), r * math.sqrt(rr.random())
        x, y = cx + q * math.cos(a), cy + q * 0.85 * math.sin(a)
        b, l = rr.uniform(0, 6.28), rr.uniform(0.1, 0.3)
        c = int(rr.uniform(150, 225))
        d.line(G(x, y, x + l * math.cos(b), y + l * math.sin(b)), fill=(c, int(c * 0.86), int(c * 0.5)), width=4)


def glow(img, cx, cy, r, rgb, strength=0.6):
    yy, xx = np.ogrid[:H, :W]
    d = np.sqrt((xx - cx * S) ** 2 + (yy - cy * S) ** 2) / (r * S)
    g = np.clip(1 - d, 0, 1) ** 2 * strength
    return img + (col(rgb) - img) * g[..., None] * 0.9 + col(rgb) * g[..., None] * 0.15


def mask_from(draw_fn):
    im = Image.new("L", (W, H), 0)
    draw_fn(ImageDraw.Draw(im))
    return np.asarray(im, np.float32) / 255


def G(*v):
    return [c * S for c in v]


# ---------- the three maps ----------

def great_hall():
    L = Layout("great-hall", 11)
    L.blob(11, 8.5, 9.6, 6.6)
    L.blob(3.6, 8.5, 2.8, 4.6)
    L.blob(17, 5.5, 4, 3.6)
    L.blob(14, 12.5, 4, 3)
    L.tunnel([(7, 4), (7, 0)], 2.4)
    L.tunnel([(12.5, 13), (12.5, 17)], 3.4)
    L.tunnel([(18, 8.5), (22, 8.5)], 3.4)
    L.rect(5, 4, 18, 13)                      # the old gallery, cut square
    L.rect(1.4, 5.5, 5, 11.5)                 # the dais
    L.rect(0.9, 8, 1.5, 9)                    # the Lamp's niche
    L.exit("east: to the goat ledges", "E", 7, 10, "goat-ledges", "west")
    L.exit("north: to the forge (later map)", "N", 6, 8, None, None)
    L.exit("south: to the family chambers (later map)", "S", 11, 14, None, None)
    floor = L.floor()

    paved = mask_from(lambda d: (d.rectangle(G(5, 4, 18, 13), fill=255), d.rectangle(G(1.4, 5.5, 5, 11.5), fill=255)))
    img = paint(floor, paved, None, 11)

    # dais: lighter stone, raised edge and steps
    dais = mask_from(lambda d: d.rectangle(G(1.4, 5.5, 5, 11.5), fill=255))
    img = mix(img, img * 1.18, dais)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    dress(d, (blur(floor, 25) > 0.97) * (1 - blur(paved, 20) * 2).clip(0, 1), 11)
    d.rectangle(G(1.4, 5.5, 5, 11.5), outline=(58, 52, 48), width=10)
    for i in range(3):
        x = 5 + i * 0.22
        d.line(G(x, 7, x, 10), fill=(70, 64, 58), width=8)
    # pillars
    for x in (7, 10.5, 14, 17):
        for y in (4.6, 12.4):
            d.rectangle(G(x - 0.45, y - 0.45, x + 0.45, y + 0.45), fill=(150, 144, 134), outline=(55, 50, 46), width=8)
            d.rectangle(G(x - 0.3, y - 0.3, x + 0.3, y + 0.3), outline=(110, 104, 96), width=5)
    # benches round the fire
    for a in range(0, 360, 60):
        r = 3.1
        cx, cy = 11 + r * math.cos(math.radians(a)), 8.5 + r * math.sin(math.radians(a))
        ang = math.radians(a + 90)
        dx, dy = math.cos(ang) * 0.9, math.sin(ang) * 0.9
        d.line(G(cx - dx, cy - dy, cx + dx, cy + dy), fill=(96, 66, 42), width=44)
        d.line(G(cx - dx, cy - dy, cx + dx, cy + dy), fill=(120, 84, 54), width=30)
    # common fire: stone ring and embers
    d.ellipse(G(11 - 1.6, 8.5 - 1.6, 11 + 1.6, 8.5 + 1.6), fill=(96, 92, 88), outline=(50, 46, 44), width=10)
    d.ellipse(G(11 - 1.15, 8.5 - 1.15, 11 + 1.15, 8.5 + 1.15), fill=(60, 34, 24))
    d.ellipse(G(11 - 0.8, 8.5 - 0.8, 11 + 0.8, 8.5 + 0.8), fill=(210, 92, 34))
    # the Lamp of 1391 in its niche; scroll chests on the dais
    d.rectangle(G(0.9, 8.0, 1.5, 9.0), fill=(44, 38, 34))                    # the niche, cut deep
    d.rectangle(G(0.95, 8.55, 1.45, 8.9), fill=(120, 114, 106))              # its stone shelf
    d.ellipse(G(1.02, 8.36, 1.38, 8.64), fill=(150, 92, 56), outline=(70, 40, 24), width=4)   # clay lamp
    d.polygon([tuple(G(*p)) for p in ((1.33, 8.5), (1.48, 8.44), (1.48, 8.56))], fill=(150, 92, 56))
    d.ellipse(G(1.44, 8.44, 1.54, 8.56), fill=(255, 226, 140))               # its flame
    for x, y in ((2.2, 6.2), (2.2, 10.2), (3.6, 6.2), (3.6, 10.2)):
        d.rectangle(G(x - 0.4, y - 0.3, x + 0.4, y + 0.3), fill=(110, 76, 46), outline=(60, 40, 26), width=6)
    img = np.asarray(im, np.float32)
    img = glow(img, 11, 8.5, 6.5, (255, 140, 60), 0.55)
    img = glow(img, 1.25, 8.5, 2.6, (255, 215, 130), 0.5)
    return L, img, [
        {"kind": "fire", "x": 11, "y": 8.5, "dim": 40, "bright": 20, "color": "#ff8c3c"},
        {"kind": "lamp", "x": 1.25, "y": 8.5, "dim": 15, "bright": 5, "color": "#ffd782"},
    ]


def goat_ledges():
    L = Layout("goat-ledges", 22)
    L.blob(10.5, 9.5, 8.5, 5.8)
    L.blob(16.2, 4.5, 4, 3.6)
    L.blob(4.6, 12.6, 3.6, 3)
    L.blob(15.5, 12.5, 4.5, 3.4)
    L.tunnel([(0, 8.5), (5, 8.5)], 3.4)
    L.tunnel([(16.5, 6), (16.5, 0)], 3.4)
    L.exit("west: to the Great Hall", "W", 7, 10, "great-hall", "east")
    L.exit("north: the long climb to the Door", "N", 15, 18, "the-door", "south")
    floor = L.floor()

    water = mask_from(lambda d: d.ellipse(G(13.2, 10.8, 18.6, 14.4), fill=255))
    water = (blur(water, 18) + (noise(0.8, 2, seed=5) - 0.5) * 0.4 > 0.5).astype(np.float32)
    img = paint(floor, None, water, 22)

    # lichen the goats crop: grey-green patches
    lich = ((noise(0.9, 3, seed=9) > 0.58) * floor * (1 - blur(water, 25) * 1.5)).clip(0, 1)
    lich = blur(lich.astype(np.float32), 4)
    img = mix(img, col((104, 116, 88)) * (0.85 + 0.3 * noise(0.1, 2, seed=3))[..., None], lich * 0.75)

    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    keep = mask_from(lambda q: (q.ellipse(G(2.6, 10.6, 6.8, 15.4), fill=255), q.rectangle(G(7.8, 3.6, 11.4, 7.2), fill=255)))
    dress(d, (blur(floor, 25) > 0.97) * (1 - blur(water, 20) * 2).clip(0, 1) * (1 - keep), 22)
    # ledges: tier edges as a dark drop line with a pale lip
    for pts in ([(6, 3.6), (7.2, 7), (6.8, 10.5), (8, 14.4)],
                [(11.5, 3.6), (12.4, 6.4), (11.2, 9)],
                [(12, 15), (11.6, 11.8), (13.2, 9.8)]):
        g = [tuple(G(x, y)) for x, y in pts]
        d.line(g, fill=(46, 40, 36), width=26, joint="curve")
        d.line([(x - 12, y) for x, y in g], fill=(150, 140, 124), width=8, joint="curve")
    # the stair the Hearth-guard holds (west) and the climb (north)
    for i in range(6):
        x = 1.2 + i * 0.5
        d.line(G(x, 7.2, x, 9.8), fill=(70, 64, 58), width=10)
    for i in range(7):
        y = 0.5 + i * 0.6
        d.line(G(15.2, y, 17.8, y), fill=(70, 64, 58), width=10)
    # goat pen and hay
    pen = [(8.2, 4.2), (10.8, 4.0), (11.0, 6.6), (8.4, 6.8), (8.2, 5.6)]
    d.line([tuple(G(x, y)) for x, y in pen], fill=(104, 72, 44), width=16)
    for x, y in pen:
        d.ellipse(G(x - 0.12, y - 0.12, x + 0.12, y + 0.12), fill=(80, 54, 32))
    hay(d, 9.6, 5.25, 0.65, 4)
    # the cracked seal in the floor, chalk ring dark, rubble round it
    cx, cy = 4.6, 13
    d.ellipse(G(cx - 1.3, cy - 1.3, cx + 1.3, cy + 1.3), fill=(136, 132, 126), outline=(52, 48, 46), width=12)
    d.ellipse(G(cx - 1.0, cy - 1.0, cx + 1.0, cy + 1.0), outline=(150, 176, 190), width=6)
    for a, l in ((20, 1.2), (130, 1.1), (250, 1.25), (300, 0.7)):
        d.line(G(cx, cy, cx + l * math.cos(math.radians(a)), cy + l * math.sin(math.radians(a))),
               fill=(20, 18, 18), width=12)
    d.polygon([tuple(G(*p)) for p in ((cx - 0.3, cy - 0.2), (cx + 0.4, cy - 0.1), (cx + 0.1, cy + 0.45))], fill=(14, 12, 12))
    rr = np.random.default_rng(7)
    for _ in range(14):
        a, r = rr.random() * 6.28, 1.4 + rr.random() * 0.9
        x, y, s = cx + r * math.cos(a), cy + r * math.sin(a), 0.1 + rr.random() * 0.15
        d.ellipse(G(x - s, y - s, x + s, y + s), fill=(120, 116, 110), outline=(50, 46, 44), width=4)
    # mine lamps on the walls
    lamps = [(3.2, 6.6), (13.8, 4.4), (8.4, 15.0), (19.4, 9.6)]
    for x, y in lamps:
        d.ellipse(G(x - 0.15, y - 0.15, x + 0.15, y + 0.15), fill=(250, 190, 100))
    img = np.asarray(im, np.float32)
    for x, y in lamps:
        img = glow(img, x, y, 2.2, (255, 180, 90), 0.45)
    img = glow(img, 15.9, 12.6, 3.5, (110, 210, 190), 0.35)   # the pool's fungus glow
    return L, img, [{"kind": "lamp", "x": x, "y": y, "dim": 15, "bright": 5, "color": "#ffb45a"} for x, y in lamps] + [
        {"kind": "fungus", "x": 15.9, "y": 12.6, "dim": 15, "bright": 0, "color": "#6ed2be"}]


def the_door():
    L = Layout("the-door", 33)
    L.tunnel([(16.5, 17), (16.5, 13.5), (13.5, 11.5)], 3.4)
    L.blob(14.5, 12.6, 3, 2)
    L.blob(4.5, 8, 2.6, 3)
    L.blob(18.6, 7.5, 2.4, 3)
    L.rect(4, 4, 19, 11.5)                    # the gatehouse, cut square
    L.rect(9, 1.6, 13, 4)                     # the Door's passage
    L.rect(16.4, 1.6, 17.4, 4)                # the Postern, one square wide
    L.rect(0, 0, GW, 1.8)                     # outside: the mountainside
    L.exit("south: down the long climb to the goat ledges", "S", 15, 18, "goat-ledges", "north")
    L.exit("north: out onto the ridge (session 01)", "N", 0, GW, None, None, depth=1.8)
    floor = L.floor()

    paved = mask_from(lambda d: (d.rectangle(G(4, 4, 19, 11.5), fill=255), d.rectangle(G(9, 1.8, 13, 4), fill=255),
                                 d.rectangle(G(16.4, 1.8, 17.4, 4), fill=255)))
    img = paint(floor, paved, None, 33)
    # the mountainside in daylight: pale ash rock
    outside = mask_from(lambda d: d.rectangle(G(0, 0, GW, 1.8), fill=255))
    out_tex = (0.85 + 0.3 * noise(0.3, 4, seed=44))[..., None]
    img = mix(img, col((196, 190, 178)) * out_tex, outside)

    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    dress(d, (blur(floor, 25) > 0.97) * (1 - blur(paved, 20) * 2).clip(0, 1) * (1 - outside), 33, pebbles=50, cracks=6)
    # the Door: a 20-ft slab, swung a little open, sigil rings dark
    d.polygon([tuple(G(*p)) for p in ((9, 2.6), (13, 2.2), (13, 3.1), (9, 3.5))], fill=(118, 114, 108), outline=(40, 36, 34))
    for i, r in enumerate((0.25, 0.4)):
        d.ellipse(G(11 - r * 2, 2.85 - r, 11 + r * 2, 2.85 + r), outline=(84, 96, 108), width=5)
    d.rectangle(G(8.6, 1.6, 9, 4), fill=(80, 76, 72))
    d.rectangle(G(13, 1.6, 13.4, 4), fill=(80, 76, 72))
    # the Postern's small door, ajar
    d.line(G(16.4, 2.4, 17.2, 2.1), fill=(96, 66, 42), width=22)
    # steps down the climb
    for i in range(6):
        y = 12.2 + i * 0.75
        d.line(G(15.2, y, 17.8, y), fill=(70, 64, 58), width=10)
    # the Hearth-guard's post: braziers, spear racks, a bench, a table
    for x, y in ((6, 5.6), (17.2, 5.6)):
        d.ellipse(G(x - 0.45, y - 0.45, x + 0.45, y + 0.45), fill=(70, 58, 50), outline=(36, 30, 26), width=8)
        d.ellipse(G(x - 0.28, y - 0.28, x + 0.28, y + 0.28), fill=(230, 110, 40))
    for y in (6.8, 8.2, 9.6):
        d.rectangle(G(4.3, y, 4.6, y + 1), fill=(96, 66, 42))
        for k in range(4):
            d.line(G(4.45, y + 0.15 + k * 0.23, 5.3, y + 0.15 + k * 0.23), fill=(150, 140, 120), width=6)
    d.rectangle(G(9, 8.4, 12.5, 9.4), fill=(110, 76, 46), outline=(60, 40, 26), width=8)
    d.rectangle(G(9.2, 9.8, 12.3, 10.3), fill=(110, 76, 46))
    img = np.asarray(im, np.float32)
    img = glow(img, 6, 5.6, 3, (255, 140, 60), 0.5)
    img = glow(img, 17.2, 5.6, 3, (255, 140, 60), 0.5)
    img = glow(img, 11, 3.6, 5, (255, 248, 230), 0.55)        # daylight through the gap
    return L, img, [
        {"kind": "brazier", "x": 6, "y": 5.6, "dim": 20, "bright": 10, "color": "#ff8c3c"},
        {"kind": "brazier", "x": 17.2, "y": 5.6, "dim": 20, "bright": 10, "color": "#ff8c3c"},
        {"kind": "daylight", "x": 11, "y": 3.6, "dim": 30, "bright": 15, "color": "#fff8e6"},
    ]


# ---------- previews ----------

def font(size):
    for f in ("arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def preview(img, layout, title):
    im = img.copy().convert("RGBA")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for x in range(0, W + 1, S):
        d.line([(x, 0), (x, H)], fill=(255, 255, 255, 40), width=2)
    for y in range(0, H + 1, S):
        d.line([(0, y), (W, y)], fill=(255, 255, 255, 40), width=2)
    for e in layout.exits:
        r = e["region"]["px"]
        box = [r["x"], r["y"], r["x"] + r["width"] - 1, r["y"] + r["height"] - 1]
        linked = e["to"] is not None
        d.rectangle(box, fill=(80, 200, 255, 90) if linked else (255, 200, 80, 70),
                    outline=(80, 200, 255, 255) if linked else (255, 200, 80, 255), width=8)
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    f, fs = font(64), font(40)
    d.text((40, H - 100), title, fill="white", font=f, stroke_width=4, stroke_fill="black")
    for e in layout.exits:
        r = e["region"]["px"]
        tx = min(max(r["x"] + 20, 20), W - 900)
        ty = min(max(r["y"] + (r["height"] if e["edge"] == "N" else -60), 20), H - 160)
        d.text((tx, ty), e["name"], fill="white", font=fs, stroke_width=3, stroke_fill="black")
    return im.convert("RGB")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/TheHearth/sketches")
    os.makedirs(out, exist_ok=True)
    maps = [("great-hall", "The Great Hall", great_hall),
            ("goat-ledges", "The goat ledges", goat_ledges),
            ("the-door", "The Door and the Postern", the_door)]
    data, prev = {}, {}
    for slug, title, fn in maps:
        L, img, lights = fn()
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        im.save(os.path.join(out, f"{slug}.png"))
        p = preview(im, L, title)
        p.save(os.path.join(out, f"{slug}-preview.jpg"), quality=85)
        prev[slug] = p
        data[slug] = {"title": title, "grid": {"size": S, "width": GW, "height": GH},
                      "image": f"{slug}.png", "exits": L.exits,
                      "lights": [dict(l, px={"x": l["x"] * S, "y": l["y"] * S}) for l in lights]}
        print(slug, im.size)
    with open(os.path.join(out, "exits.json"), "w") as fh:
        json.dump(data, fh, indent=2)

    # the three laid edge to edge, to show the exits meet
    k = 0.25
    w, h = int(W * k), int(H * k)
    sheet = Image.new("RGB", (w * 2, h * 2), (0, 0, 0))
    sheet.paste(prev["the-door"].resize((w, h)), (w, 0))
    sheet.paste(prev["great-hall"].resize((w, h)), (0, h))
    sheet.paste(prev["goat-ledges"].resize((w, h)), (w, h))
    sheet.save(os.path.join(out, "00-linked.jpg"), quality=85)


if __name__ == "__main__":
    main()
