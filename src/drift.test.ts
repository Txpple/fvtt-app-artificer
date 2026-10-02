import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DRIFT_TILE_LIMIT, measureDrift } from './drift.js';

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

/** Shift a region of an image by (dx, dy), filling from the original around it. */
async function shiftRegion(
  img: Buffer,
  region: { left: number; top: number; width: number; height: number },
  dx: number,
  dy: number
): Promise<Buffer> {
  const piece = await sharp(img).extract(region).toBuffer();
  return sharp(img)
    .composite([{ input: piece, left: region.left + dx, top: region.top + dy }])
    .png()
    .toBuffer();
}

describe('measureDrift', () => {
  it('measures an identical map as unmoved', async () => {
    const src = await noiseMap(800, 600);
    const d = await measureDrift(src, src);
    expect(d.tiles).toBeGreaterThan(50);
    expect(d.tiles).toBe(d.textured);
    expect(d.max).toBeLessThan(1e-9);
    expect(d.structure).toBeCloseTo(1, 3);
    expect(d.failed).toBe(false);
  });

  it('passes a restyle that changes texture but not position', async () => {
    const src = await noiseMap(800, 600);
    const restyled = await sharp(src)
      .modulate({ saturation: 0.5, hue: 40 })
      .sharpen()
      .blur(1)
      .png()
      .toBuffer();
    const d = await measureDrift(src, restyled);
    expect(d.p95).toBeLessThan(DRIFT_TILE_LIMIT);
    expect(d.failed).toBe(false);
  });

  it('fails a map whose whole layout slid, and reports the slide', async () => {
    const src = await noiseMap(800, 600);
    // Two pipelines: within one, sharp extracts before it extends.
    const wide = await sharp(src).extend({ left: 12, extendWith: 'mirror' }).png().toBuffer();
    const slid = await sharp(wide)
      .extract({ left: 0, top: 0, width: 800, height: 600 })
      .png()
      .toBuffer();
    const d = await measureDrift(src, slid);
    expect(d.median * 800).toBeGreaterThan(10);
    expect(d.failed).toBe(true);
    expect(Math.abs(d.worst[0].dx)).toBeGreaterThan(10);
  });

  it('fails a map with one region warped out of place', async () => {
    const src = await noiseMap(800, 600);
    const warped = await shiftRegion(src, { left: 100, top: 100, width: 300, height: 300 }, 20, 10);
    const d = await measureDrift(src, warped);
    expect(d.drifted).toBeGreaterThan(3);
    expect(d.failed).toBe(true);
  });

  it('fails a render that is a different map altogether (nothing locks on)', async () => {
    const d = await measureDrift(await noiseMap(800, 600, 1), await noiseMap(800, 600, 99));
    expect(d.failed).toBe(true);
  });

  it('says nothing about a featureless map instead of failing it', async () => {
    const flat = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#335533' },
    })
      .png()
      .toBuffer();
    const d = await measureDrift(flat, flat);
    expect(d.textured).toBe(0);
    expect(d.failed).toBe(false);
  });

  it('compares across sizes: an upscaled delivery is measured on the source grid', async () => {
    const src = await noiseMap(400, 300);
    const up = await sharp(src).resize(1200, 900).png().toBuffer();
    const d = await measureDrift(src, up);
    expect(d.failed).toBe(false);
    expect(d.p95).toBeLessThan(DRIFT_TILE_LIMIT);
  });
});
