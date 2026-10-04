// Layout-drift check for battlemaps. Owner rule 2026-10-02: walls, doors, and lights are traced
// over a bought map in Foundry, so a restyle may change how the map is painted but never where
// anything is. Measurable: reduce both images to edge strength (a restyle changes colour and
// texture; edges stay put), then phase-correlate overlapping tiles. Each textured tile yields the
// local displacement of the restyle against the source. Deterministic; sharp only.

import sharp from 'sharp';

/** Long side of the working copies the check runs on, in pixels. */
export const DRIFT_WORK_EDGE = 1024;
/** Tile edge and stride on the working copies. A power of two: the FFT is radix-2. */
export const DRIFT_TILE = 128;
export const DRIFT_STEP = 64;
/** A tile whose edge strength varies less than this has nothing to lock on (open water, flat grass). */
const MIN_TEXTURE = 2;
/** Correlation peak over the mean response; below this the tile's answer is noise. */
const MIN_CONFIDENCE = 8;

/**
 * A tile moved by more than this share of the map's long side has drifted: about a tenth of a
 * grid cell on a 30-cell map, where a traced wall would visibly miss its painted wall.
 */
export const DRIFT_TILE_LIMIT = 0.004;
/**
 * More drifted tiles than this share of the measured ones fails the map. A single tile can
 * mismeasure on repetitive texture (roof shingles, floor tiles); a real warp moves a region.
 */
export const DRIFT_SHARE_LIMIT = 0.03;

/**
 * Fewer confident tiles than this share of the textured ones fails the map: the restyle no longer
 * correlates with its source anywhere much, so nothing can be said to have stayed in place.
 */
export const DRIFT_LOCK_MIN = 0.5;

/**
 * An overland map is checked looser (owner request 2026-10-03): nothing is traced over it, and
 * the names and markers it is painted bare of are themselves edges, so some tiles always move.
 * The check is there to catch a swapped or reshaped geography, not a repainted coastline: the
 * first two renders of the Halruaa map drifted on 18% and 9% of tiles and were both faithful.
 */
export const OVERLAND_DRIFT_SHARE_LIMIT = 0.25;
/** Lettering removed from a textured tile can stop it locking on; half is too strict here. */
export const OVERLAND_LOCK_MIN = 0.25;

/** True when an overland map's geography moved grossly: swapped, reshaped, or unmatched. */
export function overlandDrifted(d: DriftReport): boolean {
  const lockedOn = d.textured === 0 || d.tiles / d.textured >= OVERLAND_LOCK_MIN;
  return !lockedOn || (d.tiles > 0 && d.drifted / d.tiles > OVERLAND_DRIFT_SHARE_LIMIT);
}

export interface DriftReport {
  /** Tiles with enough texture in the source to measure. */
  textured: number;
  /** Textured tiles measured with a confident answer. */
  tiles: number;
  /** Displacement over those tiles, as a share of the long side. */
  median: number;
  p95: number;
  max: number;
  /** Tiles displaced by more than DRIFT_TILE_LIMIT. */
  drifted: number;
  /** Median edge correlation after alignment, 0..1: how much of the source's structure survived. */
  structure: number;
  /** The worst tiles, centre and displacement in source pixels. */
  worst: Array<{ x: number; y: number; dx: number; dy: number }>;
  /** True when the drifted share is over DRIFT_SHARE_LIMIT or too few tiles locked on. */
  failed: boolean;
}

/** Edge strength of an image at the working size, row-major. */
async function edges(img: Buffer, w: number, h: number): Promise<Float32Array> {
  const { data } = await sharp(img)
    .removeAlpha()
    .resize(w, h, { fit: 'fill' })
    .greyscale()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i + 1] - data[i - 1];
      const gy = data[i + w] - data[i - w];
      g[i] = Math.hypot(gx, gy);
    }
  }
  return g;
}

/** In-place iterative radix-2 FFT of one complex row (n a power of two). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 2-D FFT of an n×n complex grid, rows then columns. */
function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const r = new Float64Array(n);
  const i = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n));
    i.set(im.subarray(y * n, y * n + n));
    fft(r, i, inverse);
    re.set(r, y * n);
    im.set(i, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x];
      i[y] = im[y * n + x];
    }
    fft(r, i, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y];
      im[y * n + x] = i[y];
    }
  }
}

const N = DRIFT_TILE;
const HANN = (() => {
  const w = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      w[y * N + x] =
        0.25 *
        (1 - Math.cos((2 * Math.PI * x) / (N - 1))) *
        (1 - Math.cos((2 * Math.PI * y) / (N - 1)));
    }
  }
  return w;
})();

/** Copy one tile out, mean-removed and windowed. Returns null when it has no texture. */
function tile(g: Float32Array, w: number, x0: number, y0: number): Float64Array | null {
  const t = new Float64Array(N * N);
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = g[(y0 + y) * w + x0 + x];
      t[y * N + x] = v;
      sum += v;
      sq += v * v;
    }
  }
  const mean = sum / (N * N);
  const sd = Math.sqrt(Math.max(0, sq / (N * N) - mean * mean));
  if (sd < MIN_TEXTURE) return null;
  for (let k = 0; k < N * N; k++) t[k] = (t[k] - mean) * HANN[k];
  return t;
}

/** Phase-correlate two windowed tiles: the displacement of b against a, and the peak confidence. */
function correlate(
  a: Float64Array,
  b: Float64Array
): { dx: number; dy: number; confidence: number } {
  const ar = Float64Array.from(a);
  const ai = new Float64Array(N * N);
  const br = Float64Array.from(b);
  const bi = new Float64Array(N * N);
  fft2(ar, ai, N, false);
  fft2(br, bi, N, false);
  for (let k = 0; k < N * N; k++) {
    // a · conj(b), normalised to unit magnitude: only the phase (the shift) survives.
    const re = ar[k] * br[k] + ai[k] * bi[k];
    const im = ai[k] * br[k] - ar[k] * bi[k];
    const mag = Math.hypot(re, im) + 1e-12;
    ar[k] = re / mag;
    ai[k] = im / mag;
  }
  fft2(ar, ai, N, true);
  let peak = 0;
  let best = -Infinity;
  let absSum = 0;
  for (let k = 0; k < N * N; k++) {
    absSum += Math.abs(ar[k]);
    if (ar[k] > best) {
      best = ar[k];
      peak = k;
    }
  }
  const py = Math.floor(peak / N);
  const px = peak % N;
  const at = (y: number, x: number) => ar[((y + N) % N) * N + ((x + N) % N)];
  const refine = (c: number, m: number, p: number) => {
    const d = m - 2 * c + p;
    return d === 0 ? 0 : (0.5 * (m - p)) / d;
  };
  let sy = py + refine(best, at(py - 1, px), at(py + 1, px));
  let sx = px + refine(best, at(py, px - 1), at(py, px + 1));
  if (sy > N / 2) sy -= N;
  if (sx > N / 2) sx -= N;
  // The peak sits at minus the displacement of b against a.
  return { dx: -sx, dy: -sy, confidence: best / (absSum / (N * N) + 1e-12) };
}

/** Pearson correlation of two tiles after shifting b back by a whole-pixel displacement. */
function structureOf(
  ga: Float32Array,
  gb: Float32Array,
  w: number,
  x0: number,
  y0: number,
  dx: number,
  dy: number
): number {
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = Math.max(0, -oy); y < N - Math.max(0, oy); y++) {
    for (let x = Math.max(0, -ox); x < N - Math.max(0, ox); x++) {
      const a = ga[(y0 + y) * w + x0 + x];
      const b = gb[(y0 + y + oy) * w + x0 + x + ox];
      n++;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;

/** Measure how far a restyled map moved against its source. Both are any size; same aspect expected. */
export async function measureDrift(source: Buffer, result: Buffer): Promise<DriftReport> {
  const m = await sharp(source).metadata();
  const sw = m.width ?? 1;
  const sh = m.height ?? 1;
  const long = Math.max(sw, sh);
  const k = Math.min(1, DRIFT_WORK_EDGE / long);
  const w = Math.max(N, Math.round(sw * k));
  const h = Math.max(N, Math.round(sh * k));
  const [ga, gb] = await Promise.all([edges(source, w, h), edges(result, w, h)]);

  const shifts: Array<{ x: number; y: number; dx: number; dy: number; d: number; s: number }> = [];
  let textured = 0;
  for (let y0 = 0; y0 + N <= h; y0 += DRIFT_STEP) {
    for (let x0 = 0; x0 + N <= w; x0 += DRIFT_STEP) {
      const a = tile(ga, w, x0, y0);
      if (!a) continue;
      textured++;
      const b = tile(gb, w, x0, y0);
      if (!b) continue;
      const c = correlate(a, b);
      if (c.confidence < MIN_CONFIDENCE) continue;
      shifts.push({
        x: x0 + N / 2,
        y: y0 + N / 2,
        dx: c.dx,
        dy: c.dy,
        d: Math.hypot(c.dx, c.dy),
        s: structureOf(ga, gb, w, x0, y0, c.dx, c.dy),
      });
    }
  }
  // Work-pixel displacement → share of the long side.
  const workLong = Math.max(w, h);
  const share = shifts.map(t => t.d / workLong).sort((a, b) => a - b);
  const drifted = share.filter(v => v > DRIFT_TILE_LIMIT).length;
  const toSource = long / workLong;
  const worst = [...shifts]
    .sort((a, b) => b.d - a.d)
    .slice(0, 5)
    .map(t => ({
      x: Math.round(t.x * toSource),
      y: Math.round(t.y * toSource),
      dx: Math.round(t.dx * toSource * 10) / 10,
      dy: Math.round(t.dy * toSource * 10) / 10,
    }));
  const structure = quantile(
    shifts.map(t => t.s).sort((a, b) => a - b),
    0.5
  );
  const lockedOn = textured === 0 || shifts.length / textured >= DRIFT_LOCK_MIN;
  return {
    textured,
    tiles: shifts.length,
    median: quantile(share, 0.5),
    p95: quantile(share, 0.95),
    max: share.at(-1) ?? 0,
    drifted,
    structure,
    worst,
    failed: !lockedOn || (shifts.length > 0 && drifted / shifts.length > DRIFT_SHARE_LIMIT),
  };
}
