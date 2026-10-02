// Battlemap geometry. A bought map is restyled in place (owner request 2026-10-02): Foundry walls,
// doors, and lights are traced over it, so the result must land on the source's exact pixel grid.
// The API only renders fixed aspects at fixed sizes, so the source is padded to the nearest API
// aspect before it is sent, and the render is mapped back onto the source's grid afterwards.

import sharp from 'sharp';
import type { Aspect } from './gemini.js';
import { nearestAspect } from './presets.js';

/**
 * Mirrored margin around the source, as a share of its long side. The API does not render its
 * nominal aspect exactly (3:4 at 2K is 1792×2400, not 1800×2400): it scales the input to cover
 * the output and trims the excess, 4 px off each side of the garden map (2026-10-02). The margin
 * gives that trim something other than the map to eat.
 */
export const MAP_MARGIN = 0.02;

export interface PadPlan {
  aspect: Aspect;
  source: { width: number; height: number };
  /** The canvas sent to the API: the source plus a mirrored margin, at the API aspect. */
  padded: { width: number; height: number };
  /** Where the source sits on that canvas. */
  offset: { x: number; y: number };
}

/** Plan the padded canvas for a source of this size. Pure. */
export function padPlan(width: number, height: number): PadPlan {
  const m = Math.ceil(Math.max(width, height) * MAP_MARGIN);
  let w = width + 2 * m;
  let h = height + 2 * m;
  const aspect = nearestAspect(width / height);
  const [aw, ah] = aspect.split(':').map(Number);
  // Grow whichever side is short of the aspect; never shrink, so the source is never cut.
  if (w / h < aw / ah) w = Math.ceil((h * aw) / ah);
  else h = Math.ceil((w * ah) / aw);
  return {
    aspect,
    source: { width, height },
    padded: { width: w, height: h },
    offset: { x: Math.floor((w - width) / 2), y: Math.floor((h - height) / 2) },
  };
}

/** Pad the source to the plan's canvas with mirrored edges (a natural continuation, not a frame). */
export async function padSource(source: Buffer, plan: PadPlan): Promise<Buffer> {
  const { padded, offset, source: s } = plan;
  return sharp(source)
    .removeAlpha()
    .extend({
      left: offset.x,
      top: offset.y,
      right: padded.width - s.width - offset.x,
      bottom: padded.height - s.height - offset.y,
      extendWith: 'mirror',
    })
    .png()
    .toBuffer();
}

/**
 * Where the source lies on a render of the padded canvas. The API covers its output with the
 * input (one uniform scale) and centre-trims the excess; measured, not assumed: the drift check
 * after every render would catch a model that started doing anything else.
 */
export function sourceRegion(
  plan: PadPlan,
  outWidth: number,
  outHeight: number
): { left: number; top: number; width: number; height: number } {
  const { padded, offset, source } = plan;
  const k = Math.max(outWidth / padded.width, outHeight / padded.height);
  const trimX = (padded.width * k - outWidth) / 2;
  const trimY = (padded.height * k - outHeight) / 2;
  const left = Math.max(0, Math.round(offset.x * k - trimX));
  const top = Math.max(0, Math.round(offset.y * k - trimY));
  return {
    left,
    top,
    width: Math.min(outWidth - left, Math.round(source.width * k)),
    height: Math.min(outHeight - top, Math.round(source.height * k)),
  };
}

/**
 * The whole-number scale a map is delivered at: 1 for a source the render cannot beat, more for
 * an old low-resolution map the render has the pixels to improve (owner goal 2026-10-02: upscale
 * older art). A whole number keeps the grid a whole number of pixels per cell, and Foundry draws
 * a scene's background to the scene's own dimensions, so traced walls still land.
 */
export function deliveryScale(plan: PadPlan, region: { width: number; height: number }): number {
  const k = Math.min(region.width / plan.source.width, region.height / plan.source.height);
  return Math.max(1, Math.floor(k + 1e-6));
}

/**
 * Cut the source's region out of the render and land it on the source's pixel grid, at the
 * delivery scale, as PNG.
 */
export async function mapBack(
  render: Buffer,
  plan: PadPlan
): Promise<{ png: Buffer; scale: number; width: number; height: number }> {
  const m = await sharp(render).metadata();
  const region = sourceRegion(plan, m.width ?? 0, m.height ?? 0);
  const scale = deliveryScale(plan, region);
  const width = plan.source.width * scale;
  const height = plan.source.height * scale;
  const png = await sharp(render)
    .extract(region)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { png, scale, width, height };
}
