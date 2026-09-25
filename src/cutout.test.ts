import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildArgs, makeCutout, parseScriptOutput } from './cutout.js';

describe('buildArgs', () => {
  it('maps every option to the script flags and resolves named keys to hex', () => {
    const args = buildArgs({
      input: 'in.png',
      output: 'out.png',
      method: 'chroma',
      color: 'magenta',
      keepShadow: true,
      dropShadow: true,
      erode: 2,
      size: 256,
      padPct: 8,
      trim: false,
    });
    expect(args[0]).toMatch(/token_cutout\.py$/);
    expect(args.slice(1)).toEqual([
      'in.png',
      'out.png',
      '--method',
      'chroma',
      '--color',
      'FF00FF',
      '--keep-shadow',
      '--drop-shadow',
      '--erode',
      '2',
      '--size',
      '256',
      '--pad',
      '8',
      '--no-trim',
    ]);
  });

  it('passes a raw hex colour through without the hash and defaults to auto', () => {
    const args = buildArgs({ input: 'a', output: 'b', color: '#123abc' });
    expect(args).toContain('123abc');
    expect(args).toContain('auto');
  });
});

describe('parseScriptOutput', () => {
  it('reads the method and coverage lines', () => {
    expect(
      parseScriptOutput(
        'method: chroma\nsaved: x (512x512 RGBA)\nsubject coverage: 39.2%  background removed: 60.8%'
      )
    ).toEqual({ method: 'chroma', coveragePct: 39.2 });
  });

  it('rejects output it does not understand', () => {
    expect(() => parseScriptOutput('Traceback ...')).toThrow(/not understood/);
  });
});

// The real script needs python + Pillow + numpy on this machine. Skip cleanly elsewhere.
const havePython = (() => {
  try {
    return spawnSync('python', ['-c', 'import PIL, numpy'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!havePython)('makeCutout (real script)', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-cutout-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('cuts a grey disc off a green plate to a 512 RGBA square with a preview', async () => {
    const plate = path.join(tmp, 'plate.png');
    const disc = Buffer.from(
      '<svg width="200" height="200"><rect width="200" height="200" fill="#00ff00"/>' +
        '<circle cx="100" cy="100" r="60" fill="#808080"/></svg>'
    );
    fs.writeFileSync(plate, await sharp(disc).png().toBuffer());
    const cut = await makeCutout('python')({
      input: plate,
      output: path.join(tmp, 'cut.png'),
      method: 'chroma',
      color: 'green',
    });
    expect(cut.method).toBe('chroma');
    expect(cut.width).toBe(512);
    expect(cut.height).toBe(512);
    expect(cut.coveragePct).toBeGreaterThan(20);
    expect(cut.coveragePct).toBeLessThan(40);
    expect(cut.residualKeyPct).toBeLessThan(1);
    expect(fs.existsSync(cut.preview)).toBe(true);
    const meta = await sharp(cut.file).metadata();
    expect(meta.channels).toBe(4);
  });

  it("'auto' runs chroma first even though rembg may be installed", async () => {
    const plate = path.join(tmp, 'plate2.png');
    const disc = Buffer.from(
      '<svg width="200" height="200"><rect width="200" height="200" fill="#ff00ff"/>' +
        '<circle cx="100" cy="100" r="60" fill="#808080"/></svg>'
    );
    fs.writeFileSync(plate, await sharp(disc).png().toBuffer());
    const cut = await makeCutout('python')({
      input: plate,
      output: path.join(tmp, 'cut2.png'),
      color: 'magenta',
    });
    expect(cut.method).toBe('chroma');
    expect(cut.fellBackToRembg).toBeUndefined();
    expect(cut.coveragePct).toBeGreaterThan(20);
  });

  it('drops a dark, partly transparent shadow down-right of the subject, inside the square', async () => {
    const plate = path.join(tmp, 'plate3.png');
    const disc = Buffer.from(
      '<svg width="200" height="200"><rect width="200" height="200" fill="#00ff00"/>' +
        '<circle cx="100" cy="100" r="60" fill="#808080"/></svg>'
    );
    fs.writeFileSync(plate, await sharp(disc).png().toBuffer());
    const cut = await makeCutout('python')({
      input: plate,
      output: path.join(tmp, 'cut3.png'),
      method: 'chroma',
      color: 'green',
      dropShadow: true,
    });
    // Coverage still measures the matte alone, not matte + shadow.
    expect(cut.coveragePct).toBeLessThan(40);
    const { data, info } = await sharp(cut.file).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * 4;
      return { rgb: Math.max(data[i], data[i + 1], data[i + 2]), a: data[i + 3] };
    };
    // Scan the diagonal from the centre toward the bottom-right corner: disc, then shadow, then clear.
    let shadow = 0;
    let lastA = 255;
    for (let t = 256; t < 512; t++) {
      const p = px(t, t);
      if (p.a > 40 && p.a < 160 && p.rgb < 40) shadow++;
      lastA = p.a;
    }
    expect(shadow).toBeGreaterThan(3);
    expect(lastA).toBe(0); // the fit kept the shadow off the canvas edge
    // Nothing is cast up-left: the opposite diagonal goes disc → clear with no dark band.
    let upLeft = 0;
    for (let t = 255; t >= 0; t--) {
      const p = px(t, t);
      if (p.a > 40 && p.a < 160 && p.rgb < 40) upLeft++;
    }
    expect(upLeft).toBe(0);
  });

  it('refuses a missing input before spawning', async () => {
    await expect(
      makeCutout('python')({ input: path.join(tmp, 'nope.png'), output: path.join(tmp, 'o.png') })
    ).rejects.toThrow(/not found/);
  });
});
