import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dimensions, postProcess } from './post.js';

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer();
}

describe('postProcess', () => {
  it('turns a 16:9 4K render into an exact 2560×1600 PNG', async () => {
    const out = await postProcess(await jpeg(4096, 2304), 'illustration');
    expect(await dimensions(out)).toEqual({ width: 2560, height: 1600 });
    expect((await sharp(out).metadata()).format).toBe('png');
  });

  it('squares an icon to 512', async () => {
    const out = await postProcess(await jpeg(1024, 1024), 'icon');
    expect(await dimensions(out)).toEqual({ width: 512, height: 512 });
  });

  it('keeps tokens and portraits at native size but as PNG', async () => {
    for (const post of ['token', 'portrait'] as const) {
      const out = await postProcess(await jpeg(1024, 1024), post);
      expect(await dimensions(out)).toEqual({ width: 1024, height: 1024 });
      expect((await sharp(out).metadata()).format).toBe('png');
    }
  });
});
