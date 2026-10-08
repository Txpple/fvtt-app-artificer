"""Kitbash the Door & Postern from Tom Cartos pieces (POC)."""
import sys
import cv2
import numpy as np
from PIL import Image

S = 140
TC2 = "<path to>/tomcartos-itw-caves-02/maps/"
TC4 = "<path to>/tom-cartos-itw-caves-04/maps/"
OUT = sys.argv[1]


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), np.float32)


chapel = load(TC2 + "TC_ItW Caves 08 Chapel Ruins Cave_No Grid_22x17.webp")
chapel_c = load(TC2 + "TC_ItW Caves 08 Chapel Ruins Cave Clean_No Grid_22x17.webp")
store = load(TC4 + "TC_ItW Caves 13 Storage Room_No Grid_22x17.jpg")
store_c = load(TC4 + "TC_ItW Caves 13 Storage Room Clean_No Grid_22x17.jpg")
H, W = chapel.shape[:2]


def prop_mask(a, b):
    d = np.abs(a - b).max(2).astype(np.uint8)
    m = (d > 28).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    f = np.zeros_like(m)
    cs = [c for c in cs if cv2.contourArea(c) > 1500]
    cv2.drawContours(f, cs, -1, 255, -1)           # filled: no holes in pale props
    return f


def feather(m, r=3):
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), r)


cm = prop_mask(chapel, chapel_c)
sm = prop_mask(store, store_c)
img = chapel_c.copy()


def g(*v):
    return [int(round(c * S)) for c in v]


def keep_chapel(x0, y0, x1, y1):
    """Put the Chapel's own props back inside a grid box."""
    global img
    X0, Y0, X1, Y1 = g(x0, y0, x1, y1)
    m = np.zeros_like(cm)
    m[Y0:Y1, X0:X1] = cm[Y0:Y1, X0:X1]
    a = feather(m)[..., None]
    img = img * (1 - a) + chapel * a


def lift(src, mask, x0, y0, x1, y1):
    X0, Y0, X1, Y1 = g(x0, y0, x1, y1)
    return src[Y0:Y1, X0:X1].copy(), mask[Y0:Y1, X0:X1].copy()


def place(piece, cx, cy, rot=0, scale=1.0):
    """Paste a lifted prop centred on grid (cx, cy), with a soft drop shadow."""
    global img
    rgb, m = piece
    if rot:
        k = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rot]
        rgb, m = cv2.rotate(rgb, k), cv2.rotate(m, k)
    if scale != 1.0:
        rgb = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        m = cv2.resize(m, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    h, w = m.shape
    x, y = int(cx * S - w / 2), int(cy * S - h / 2)
    a = feather(m, 2)
    sh = cv2.GaussianBlur(a, (0, 0), 10) * 0.55
    sl = (slice(y + 14, y + 14 + h), slice(x + 10, x + 10 + w))
    img[sl] *= (1 - sh)[..., None]
    sl = (slice(y, y + h), slice(x, x + w))
    img[sl] = img[sl] * (1 - a[..., None]) + rgb * a[..., None]


# --- the Chapel's own props worth keeping: stores, brazier, grate, wheel, cage, rubble
keep_chapel(3, 12.5, 8.2, 16)      # the store-room: barrels, crates, chests
keep_chapel(4, 7, 5.4, 8.6)        # brazier grate
keep_chapel(6.8, 4.8, 8.2, 6.1)    # iron floor grate
keep_chapel(2.6, 7.2, 4.1, 9.5)    # the stone table (was a sarcophagus)
keep_chapel(16.8, 11.8, 18.8, 15)  # wheel and cage
keep_chapel(16, 14.6, 18.4, 16.3)  # rubble
keep_chapel(12.2, 1.6, 13.2, 2.4)  # rubble at the opening

# --- Storage Room props for the Hearth-guard post
stakes_a = lift(store, sm, 15.4, 9.3, 16.9, 11.1)
stakes_b = lift(store, sm, 18.4, 8.4, 20.3, 9.9)
rack = lift(store, sm, 13.5, 8.2, 15.6, 9.0)
table = lift(store, sm, 17.2, 1.2, 18.8, 2.9)
brazier = lift(chapel, cm, 4, 7, 5.4, 8.6)
place(stakes_b, 11.4, 3.4)
place(stakes_b, 15.3, 3.6, rot=180)
place(brazier, 11.2, 5.0)
place(brazier, 15.9, 5.0)
place(rack, 10.8, 9.0, rot=90)
place(rack, 10.8, 11.6, rot=90)
place(table, 15.2, 9.6)
place(stakes_a, 19.2, 12.6)

# --- outside: the mountainside in daylight, across the top of the map
band_h, band_w = g(1.25)[0], W
rng = np.random.default_rng(3)
n = np.zeros((band_h, band_w), np.float32)
for cell, amp in ((90, 1.0), (40, 0.5), (14, 0.3), (5, 0.15)):
    r = rng.random((band_h // cell + 2, band_w // cell + 2)).astype(np.float32)
    n += amp * cv2.resize(r, (band_w + 2 * cell, band_h + 2 * cell), interpolation=cv2.INTER_CUBIC)[:band_h, :band_w]
n = (n - n.min()) / (n.max() - n.min())
rock = np.array([200, 194, 182], np.float32) * (0.72 + 0.4 * n)[..., None]
yy, xx = np.mgrid[0:band_h, 0:band_w]
edge = band_h * 0.78 + 18 * np.sin(xx / 97.0) + 12 * np.sin(xx / 31.0)
a = np.clip((edge - yy) / 26, 0, 1)
xs = np.clip(np.minimum(xx - g(7.2)[0], g(19.6)[0] - xx) / 120, 0, 1)   # fades out over the void
a = (a * xs)[..., None]
img[:band_h] = img[:band_h] * (1 - a) + rock * a

# --- the Door: a slab across the opening, carved rings, standing a little open
X0, Y0, X1, Y1 = g(12.62, 0.75, 16.02, 1.9)
slab = np.array([150, 146, 138], np.float32) * (0.8 + 0.3 * cv2.resize(n, (X1 - X0, Y1 - Y0)))[..., None]
sh = np.zeros((H, W), np.float32)
sh[Y0 + 26:Y1 + 40, X0 + 16:X1 + 10] = 1
sh = cv2.GaussianBlur(sh, (0, 0), 14) * 0.6
img *= (1 - sh)[..., None]
img[Y0:Y1, X0:X1] = slab
cv2.rectangle(img, (X0, Y0), (X1, Y1), (48, 44, 40), 8)
cx, cy = (X0 + X1) // 2, (Y0 + Y1) // 2
for r in (30, 52, 74):
    cv2.ellipse(img, (cx, cy), (int(r * 2.6), r), 0, 0, 360, (92, 100, 110), 5)
cv2.line(img, (X0 + 12, Y1 - 10), (X1 - 12, Y1 - 10), (70, 66, 60), 6)
# daylight through the gap at the slab's east end
X2 = g(16.02)[0]
glow = np.zeros((H, W), np.float32)
cv2.ellipse(glow, (X2 - 60, g(2.6)[0]), (260, 420), 0, 0, 360, 1, -1)
glow = cv2.GaussianBlur(glow, (0, 0), 90) * 0.55
img = img * (1 - glow[..., None]) + np.array([255, 248, 230], np.float32) * glow[..., None]

# --- the Postern: a one-square way cut through the rock west of the Door, a small door in it
floor = chapel_c[g(2.4)[0]:g(4.2)[0], g(10.2)[0]:g(11.2)[0]] * 0.9
PX0, PY0, PX1, PY1 = g(11.4, 0.6, 12.4, 2.4)
floor = cv2.resize(floor, (PX1 - PX0, PY1 - PY0))
m = np.zeros((H, W), np.float32)
m[PY0:PY1, PX0:PX1] = 1
m = cv2.GaussianBlur(m, (0, 0), 6)[..., None]
full = np.zeros_like(img)
full[PY0:PY1, PX0:PX1] = floor
img = img * (1 - m) + full * m
cv2.rectangle(img, (PX0 + 6, g(1.2)[0]), (PX1 - 6, g(1.38)[0]), (96, 66, 40), -1)
cv2.rectangle(img, (PX0 + 6, g(1.2)[0]), (PX1 - 6, g(1.38)[0]), (40, 26, 16), 4)
for k in range(1, 4):
    x = PX0 + k * (PX1 - PX0) // 4
    cv2.line(img, (x, g(1.2)[0]), (x, g(1.38)[0]), (52, 34, 20), 3)

Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(OUT)
print("wrote", OUT)
