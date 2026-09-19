import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHROMA_KEYS, chromaSuffix, pickChromaKey, scoreKeys } from './chroma.js';

async function solid(color: string): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: color } })
    .png()
    .toBuffer();
}

describe('chromaSuffix', () => {
  it('keeps the proven sentence structure and names the key twice with its hex', () => {
    const s = chromaSuffix('magenta');
    expect(s).toContain('edge to edge and corner to corner');
    expect(s).toContain('no circle, no disc, no ring, no border, no ground, no shadow');
    expect(s).toContain(`chroma-key magenta (${CHROMA_KEYS.magenta})`);
    expect(s).toMatch(/only the figure and the flat magenta\.$/);
  });
});

describe('scoreKeys / pickChromaKey', () => {
  it('flags green as risky for a green subject and picks magenta instead', async () => {
    const goblin = await solid('#4a8a2a');
    const scores = await scoreKeys(goblin);
    expect(scores.find(s => s.key === 'green')?.risk).toBeGreaterThan(0.9);
    expect(scores.find(s => s.key === 'magenta')?.risk).toBe(0);
    expect(await pickChromaKey([goblin])).toBe('magenta');
  });

  it('avoids magenta for a purple-and-pink subject', async () => {
    expect(await pickChromaKey([await solid('#b040c0')])).toBe('green');
  });

  it('defaults to green for neutral subjects and for no samples at all', async () => {
    expect(await pickChromaKey([await solid('#888888')])).toBe('green');
    expect(await pickChromaKey([])).toBe('green');
  });

  it('takes the worst case across several samples', async () => {
    const key = await pickChromaKey([await solid('#888888'), await solid('#20c020')]);
    expect(key).toBe('magenta');
  });

  it('ignores transparent pixels when sampling', async () => {
    const mostlyClear = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    expect(await pickChromaKey([mostlyClear])).toBe('green');
  });
});
