// Post-processing: the API hands back a JPEG at its own pixel size; these turn it into the
// finished PNG each kind promises. sharp is the only image library in the server.

import sharp from 'sharp';
import { OUTPUT, type Post } from './presets.js';

/** Apply a kind's post-processing and return PNG bytes. */
export async function postProcess(input: Buffer, post: Post): Promise<Buffer> {
  switch (post) {
    case 'icon':
      // Cover-fit to the square so a slightly off-square render still fills 512×512.
      return sharp(input)
        .resize(OUTPUT.icon.width, OUTPUT.icon.height, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
    case 'illustration':
      // 16:9 → 16:10 by cover-fit: scale so the short side is 1600, then centre-crop to 2560.
      return sharp(input)
        .resize(OUTPUT.illustration.width, OUTPUT.illustration.height, {
          fit: 'cover',
          position: 'centre',
        })
        .png()
        .toBuffer();
    case 'token':
    case 'portrait':
      // Native size; format only. Tokens go on to cutout (M2) which owns the 512 square.
      return sharp(input).png().toBuffer();
  }
}

export interface Dimensions {
  width: number;
  height: number;
}

export async function dimensions(buf: Buffer): Promise<Dimensions> {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}
