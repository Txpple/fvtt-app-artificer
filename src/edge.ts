// Edge-clip check for token plates. Owner rule 2026-09-24: nothing ever clips off the image; a
// sword or a wing cut by the frame edge makes a token unusable. On a chroma plate the rule is
// measurable: any pixel in the outer band that is NOT the key colour is part of the subject.
// Deterministic; sharp only.

import sharp from 'sharp';
import { type ChromaKey, dominance } from './chroma.js';

/** Width of the outer band inspected, in pixels of the plate. */
export const EDGE_BAND = 3;

/**
 * More subject pixels than this in the band means the subject was cut by the frame. Calibrated
 * on 80 test plates (2026-09-24): the three clipped renders scored 156, 402, and 3994; every
 * clean one scored 0 except a 2-pixel JPEG speck.
 */
export const EDGE_LIMIT = 20;

/** Count subject (non-key) pixels in the plate's outer band. */
export async function edgeContact(plate: Buffer, key: ChromaKey): Promise<number> {
  const { data, info } = await sharp(plate)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const inner = y >= EDGE_BAND && y < h - EDGE_BAND;
    for (let x = 0; x < w; x++) {
      if (inner && x >= EDGE_BAND && x < w - EDGE_BAND) {
        x = w - EDGE_BAND - 1; // skip the interior of this row
        continue;
      }
      const i = (y * w + x) * channels;
      if (dominance(key, data[i], data[i + 1], data[i + 2]) < 40) n++;
    }
  }
  return n;
}
