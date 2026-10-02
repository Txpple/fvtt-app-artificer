import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  deliveryScale,
  MAP_MARGIN,
  MAP_UPLOAD_EDGE,
  mapBack,
  padPlan,
  padSource,
  sourceRegion,
} from './battlemap.js';

/** A textured test map: deterministic noise, softened, so every region is distinct. */
async function noiseMap(width: number, height: number, seed = 1): Promise<Buffer> {
  let s = seed;
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    px[i] = s >> 23;
  }
  return sharp(px, { raw: { width, height, channels: 3 } })
    .blur(1.5)
    .png()
    .toBuffer();
}

/** What the API does to an input (measured 2026-10-02): cover the output, centre-trim the excess. */
async function apiCover(input: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(input)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function meanAbsDiff(a: Buffer, b: Buffer): Promise<number> {
  const m = await sharp(a).metadata();
  const [ra, rb] = await Promise.all(
    [a, b].map(x =>
      sharp(x).removeAlpha().resize(m.width, m.height, { fit: 'fill' }).greyscale().raw().toBuffer()
    )
  );
  let sum = 0;
  for (let i = 0; i < ra.length; i++) sum += Math.abs(ra[i] - rb[i]);
  return sum / ra.length;
}

describe('padPlan', () => {
  it('pads a 3:4 map with a margin on every side and keeps the exact API aspect', () => {
    const p = padPlan(1125, 1500);
    expect(p.aspect).toBe('3:4');
    const m = Math.ceil(1500 * MAP_MARGIN);
    expect(p.offset.x).toBeGreaterThanOrEqual(m);
    expect(p.offset.y).toBeGreaterThanOrEqual(m);
    expect(p.padded.width - 1125 - p.offset.x).toBeGreaterThanOrEqual(m);
    expect(p.padded.height - 1500 - p.offset.y).toBeGreaterThanOrEqual(m);
    expect(Math.abs(p.padded.width * 4 - p.padded.height * 3)).toBeLessThanOrEqual(4);
  });

  it('grows the short side of an off-list shape (a 2:1 map goes out as 16:9)', () => {
    const p = padPlan(5600, 2800);
    expect(p.aspect).toBe('16:9');
    expect(p.padded.width).toBe(5600 + 2 * Math.ceil(5600 * MAP_MARGIN));
    expect(Math.abs(p.padded.width * 9 - p.padded.height * 16)).toBeLessThanOrEqual(16);
    expect(p.offset.y).toBeGreaterThan(p.offset.x);
  });
});

describe('sourceRegion / deliveryScale', () => {
  it('locates the source on the 1792x2400 render the garden map came back as', () => {
    const p = padPlan(1125, 1500);
    const r = sourceRegion(p, 1792, 2400);
    // The region keeps the source's shape to within a pixel and sits inside the render.
    expect(Math.abs(r.width / r.height - 1125 / 1500)).toBeLessThan(0.002);
    expect(r.left).toBeGreaterThan(0);
    expect(r.left + r.width).toBeLessThanOrEqual(1792);
    expect(r.top + r.height).toBeLessThanOrEqual(2400);
  });

  it('upscales a small source by a whole number and leaves an HD source at 1', () => {
    const small = padPlan(1125, 1500);
    expect(deliveryScale(small, sourceRegion(small, 3584, 4800))).toBe(3);
    const hd = padPlan(3220, 2520);
    expect(deliveryScale(hd, sourceRegion(hd, 4800, 3584))).toBe(1);
  });
});

describe('mapBack', () => {
  it('lands a covered-and-trimmed render back on the source grid, pixel for pixel', async () => {
    const src = await noiseMap(450, 600);
    const plan = padPlan(450, 600);
    const sent = await padSource(src, plan);
    expect(await sharp(sent).metadata()).toMatchObject(plan.padded);
    // A 3:4 render whose true shape is not quite 3:4, like the API's 1792x2400.
    const back = await mapBack(await apiCover(sent, 896, 1200), plan);
    expect(back.scale).toBe(1);
    expect(await sharp(back.png).metadata()).toMatchObject({ width: 450, height: 600 });
    expect(await meanAbsDiff(src, back.png)).toBeLessThan(6);
  });

  it('sends a map bigger than the render scaled down, and still lands it on the source grid', async () => {
    // A 6000x3600 map: rooms as rectangles and circles, so position errors show in the diff.
    const shapes = Array.from({ length: 40 }, (_, i) => {
      const x = (i * 733) % 5600;
      const y = (i * 419) % 3300;
      return i % 2
        ? `<rect x="${x}" y="${y}" width="300" height="200" fill="#${(i * 97 + 300).toString(16).slice(-3)}"/>`
        : `<circle cx="${x + 150}" cy="${y + 150}" r="140" fill="#${(i * 53 + 200).toString(16).slice(-3)}"/>`;
    }).join('');
    const src = await sharp(
      Buffer.from(
        `<svg width="6000" height="3600"><rect width="6000" height="3600" fill="#556"/>${shapes}</svg>`
      )
    )
      .png()
      .toBuffer();
    const plan = padPlan(6000, 3600);
    const sent = await padSource(src, plan);
    const m = await sharp(sent).metadata();
    expect(Math.max(m.width ?? 0, m.height ?? 0)).toBe(MAP_UPLOAD_EDGE);
    expect(m.format).toBe('jpeg');
    const back = await mapBack(await apiCover(sent, 2752, 1536), plan);
    expect(back.scale).toBe(1);
    expect(await sharp(back.png).metadata()).toMatchObject({ width: 6000, height: 3600 });
    expect(await meanAbsDiff(src, back.png)).toBeLessThan(6);
  });

  it('delivers an upscaled map at an exact multiple of the source', async () => {
    const src = await noiseMap(300, 200);
    const plan = padPlan(300, 200);
    const back = await mapBack(await apiCover(await padSource(src, plan), 1264, 848), plan);
    // The 318x212 padded canvas covers the render at 4.0x, so the map has room for 4x.
    expect(back.scale).toBe(4);
    expect(await sharp(back.png).metadata()).toMatchObject({ width: 1200, height: 800 });
    expect(await meanAbsDiff(src, back.png)).toBeLessThan(6);
  });
});
