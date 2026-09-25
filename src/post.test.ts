import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { alphaBox, dimensions, fitRect, postProcess } from './post.js';

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

describe('fitRect', () => {
  it('delivers the exact canvas, subject centred inside the margin, corners clear', async () => {
    // A 100x40 opaque bar adrift on a transparent 512 square, like a cut prop.
    const cut = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({ create: { width: 100, height: 40, channels: 4, background: '#8a5a2bff' } })
            .png()
            .toBuffer(),
          left: 30,
          top: 400,
        },
      ])
      .png()
      .toBuffer();
    const out = await fitRect(cut, 600, 300);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([600, 300, 4]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(599, 299)).toBe(0);
    expect(alpha(300, 150)).toBe(255); // trimmed and centred, not left where it was drifting
  });
});

describe('alphaBox and fitRect into a box', () => {
  async function onCanvas(w: number, h: number, box: { left: number; top: number; width: number; height: number }) {
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        {
          input: await sharp({ create: { width: box.width, height: box.height, channels: 4, background: '#8a5a2bff' } })
            .png()
            .toBuffer(),
          left: box.left,
          top: box.top,
        },
      ])
      .png()
      .toBuffer();
  }

  it('finds where the visible subject sits, or the whole canvas when there is nothing to trim', async () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    expect(await alphaBox(await onCanvas(600, 300, box))).toEqual(box);
    const opaque = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#333' } })
      .png()
      .toBuffer();
    expect(await alphaBox(opaque)).toEqual({ left: 0, top: 0, width: 30, height: 20 });
  });

  it('puts the new subject back into the original box, nowhere else', async () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    const newArt = await onCanvas(512, 512, { left: 56, top: 206, width: 400, height: 100 });
    const out = await fitRect(newArt, 600, 300, 4, box);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([600, 300]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(300, 150)).toBe(255); // centre of the box
    expect(alpha(50, 150)).toBe(0); // left of the box
    expect(alpha(550, 150)).toBe(0); // right of the box
    expect(await alphaBox(out)).toMatchObject({ left: 100, width: 400 }); // 4:1 art fills the box width
  });

  it('ignores the faint specks a cut leaves behind when trimming and measuring', async () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    const speck = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 200, g: 0, b: 200, alpha: 0.04 } } })
      .png()
      .toBuffer();
    const art = await sharp(await onCanvas(512, 512, { left: 56, top: 206, width: 400, height: 100 }))
      .composite([
        { input: speck, left: 0, top: 0 },
        { input: speck, left: 510, top: 510 },
      ])
      .png()
      .toBuffer();
    // The specks (faint, and a lone pixel each) do not count as subject...
    expect(await alphaBox(art)).toEqual({ left: 56, top: 206, width: 400, height: 100 });
    // ...so the art still fills the original box's width instead of shrinking around them.
    const out = await fitRect(art, 600, 300, 4, box);
    expect(await alphaBox(out)).toMatchObject({ left: 100, width: 400 });
  });

  it('ignores a lone opaque-ish corner pixel, the artefact that shrank the anvil', async () => {
    const dot = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 250, g: 10, b: 247, alpha: 0.15 } } })
      .png()
      .toBuffer();
    const art = await sharp(await onCanvas(512, 512, { left: 56, top: 206, width: 400, height: 100 }))
      .composite([{ input: dot, left: 511, top: 511 }])
      .png()
      .toBuffer();
    expect(await alphaBox(art)).toEqual({ left: 56, top: 206, width: 400, height: 100 });
  });
});

