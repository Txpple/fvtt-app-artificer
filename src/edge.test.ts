import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EDGE_LIMIT, edgeContact } from './edge.js';

function plate(shape: string, bg = '#00ff00'): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg width="200" height="200"><rect width="200" height="200" fill="${bg}"/>${shape}</svg>`
    )
  )
    .png()
    .toBuffer();
}

describe('edgeContact', () => {
  it('reads a subject inside the frame as clean', async () => {
    const png = await plate('<circle cx="100" cy="100" r="60" fill="#808080"/>');
    expect(await edgeContact(png, 'green')).toBe(0);
  });

  it('counts a blade crossing the bottom edge, well past the limit', async () => {
    const png = await plate('<rect x="90" y="40" width="20" height="170" fill="#c0c0c0"/>');
    const n = await edgeContact(png, 'green');
    expect(n).toBeGreaterThan(EDGE_LIMIT);
    expect(n).toBe(20 * 3); // 20 px wide, through the 3 px band
  });

  it('reads the key it is told: a green subject on magenta touching the left edge', async () => {
    const png = await plate('<rect x="0" y="80" width="60" height="40" fill="#20a020"/>', '#ff00ff');
    expect(await edgeContact(png, 'magenta')).toBeGreaterThan(EDGE_LIMIT);
    expect(await edgeContact(await plate('', '#ff00ff'), 'magenta')).toBe(0);
  });
});
