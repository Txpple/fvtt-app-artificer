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
    case 'prop':
    case 'portrait':
      // Native size; format only. Tokens go on to cutout (M2) which owns the 512 square.
      return sharp(input).png().toBuffer();
  }
}

/** A rectangle on a canvas, in pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Alpha at or above this counts as subject; fainter pixels are cut residue, not art. */
export const SUBJECT_ALPHA = 32;

/**
 * A row or column belongs to the subject only when it holds at least this many subject pixels.
 * One stray corner pixel (alpha 37, a JPEG artefact the cut kept) stretched a repainted anvil's
 * box to the canvas corner and placed the anvil at 78% of the original's size (2026-09-24).
 * Real thin features (a spear shaft, a rope) span many rows and still count.
 */
export const SUBJECT_LINE_MIN = 3;

/**
 * The bounding box of an image's subject: the rows and columns holding at least
 * SUBJECT_LINE_MIN pixels at alpha >= SUBJECT_ALPHA. The whole canvas when the image has no
 * subject. A prop edit puts the new art back into the box the original occupied.
 */
export async function alphaBox(png: Buffer): Promise<Box> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const cols = new Uint32Array(w);
  const rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * channels + 3] >= SUBJECT_ALPHA) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  const first = (a: Uint32Array) => a.findIndex(n => n >= SUBJECT_LINE_MIN);
  const last = (a: Uint32Array) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= SUBJECT_LINE_MIN) return i;
    return -1;
  };
  const left = first(cols);
  const top = first(rows);
  if (left < 0 || top < 0) return { left: 0, top: 0, width: w, height: h };
  return { left, top, width: last(cols) - left + 1, height: last(rows) - top + 1 };
}

/**
 * Fit a cut subject onto an exact transparent canvas: tighten to its alpha bounds, scale to fit
 * (aspect kept) and centre, either inside `box` (where the original subject sat) or inside the
 * canvas less a margin. Props land at their tile size this way.
 */
export async function fitRect(
  png: Buffer,
  width: number,
  height: number,
  padPct = 4,
  box?: Box
): Promise<Buffer> {
  const bounds = await alphaBox(png);
  const subject = await sharp(png).extract(bounds).png().toBuffer();
  const area = box ?? {
    left: Math.round((width * padPct) / 100),
    top: Math.round((height * padPct) / 100),
    width: Math.max(1, Math.round(width * (1 - (2 * padPct) / 100))),
    height: Math.max(1, Math.round(height * (1 - (2 * padPct) / 100))),
  };
  const scaled = await sharp(subject)
    .resize(Math.max(1, area.width), Math.max(1, area.height), { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = area.left + Math.floor((area.width - scaled.info.width) / 2);
  const top = area.top + Math.floor((area.height - scaled.info.height) / 2);
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: scaled.data, left, top }])
    .png()
    .toBuffer();
}

export interface Dimensions {
  width: number;
  height: number;
}

export async function dimensions(buf: Buffer): Promise<Dimensions> {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}
