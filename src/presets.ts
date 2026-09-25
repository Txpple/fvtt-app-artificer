// Purpose presets — the tool surface speaks `kind`, never raw dimensions or model ids. Each kind
// fixes the tier, the API aspect and size, the framing text the server appends to every prompt,
// and the post-processing that turns the API's JPEG into the finished PNG.

import { ASPECTS, type Aspect, type ImageSize, type Tier } from './gemini.js';

export const KINDS = ['icon', 'token', 'prop', 'portrait', 'illustration'] as const;
export type Kind = (typeof KINDS)[number];

export type Post = 'icon' | 'token' | 'prop' | 'portrait' | 'illustration';

export interface Preset {
  tier: Tier;
  aspect: Aspect;
  size: ImageSize;
  post: Post;
  /**
   * Appended to every prompt of this kind. Framing is correctness, so it lives here. Tokens get
   * the chroma plate sentence appended separately, with the key chosen per subject (chroma.ts).
   */
  suffix: string;
}

// Two body plans, one sentence each (2026-09-24): an upright figure keeps the face-up pitch the
// world's humanoid tokens use; a four-legged or crawling creature is seen along its back. The
// single humanoid wording turned a bear, a hound, and a troll to look up at the camera.
export const TOKEN_FRAMING =
  'Virtual tabletop token, top-down. An upright figure: the camera is high above and slightly ' +
  'in front, about fifteen degrees off vertical, never straight down and never a three-quarter ' +
  'view; the top of the head and the shoulders are the largest shapes, the torso is ' +
  'foreshortened, the feet are mostly hidden beneath the body, and the face tilts up toward the ' +
  'viewer. A four-legged, crawling, or slithering creature: seen from directly above, looking ' +
  "straight down on its back; the spine faces the camera, the head is at the leading edge " +
  'pointing forward and slightly down (not turned up toward the camera), the legs in a natural ' +
  'walking stance beside the body, and the tail trails behind. If a token is attached as a ' +
  'style reference, ' +
  'match its camera pitch exactly. A single figure, centered, filling the frame, yet the whole ' +
  'figure, including every weapon, staff, wing, tail, and cloak, sits inside the frame with a ' +
  'clear margin of background on every side; nothing touches or crosses the edge.';

export const ICON_FRAMING =
  'Inventory icon: a single subject centered and filling the frame, no text, no border, no ' +
  'frame; the whole subject sits inside the image with a small margin, nothing cut off by the edge.';

// Props are map dressing placed as tiles (owner request 2026-09-24): furniture, barrels, trees.
// Object-only wording on purpose: the token path's "keep the face, hair" made a red armchair grow
// a seated man, an oak grow a dryad, and a crate grow a dwarf in the first props test.
export const PROP_FRAMING =
  'A single map prop for a virtual tabletop battlemap, seen from directly above, looking ' +
  'straight down (orthographic top-down), an object only: no people, no creatures, no ' +
  'figures, no faces, no text. The whole object sits inside the frame with a clear margin of ' +
  'background on every side; nothing touches or crosses the edge.';

/** Tom Cartos, the bulk of the owner's prop library, draws props at 300 px per grid cell. */
export const PROP_CELL_PX = 300;

export interface Footprint {
  w: number;
  h: number;
}

/** Parse a grid footprint like "2x1" (width x height in cells, 1 to 20 each). */
export function parseFootprint(raw: string): Footprint {
  const m = /^(\d{1,2})x(\d{1,2})$/.exec(raw.trim().toLowerCase());
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  if (!m || w < 1 || h < 1 || w > 20 || h > 20) {
    throw new Error(`footprint ${JSON.stringify(raw)} must be <cells wide>x<cells tall>, e.g. "2x1"`);
  }
  return { w, h };
}

/** The API aspect closest to a width/height ratio (compared on a log scale, so 2:1 and 1:2 are symmetric). */
export function nearestAspect(ratio: number): Aspect {
  const value = (a: Aspect) => {
    const [w, h] = a.split(':').map(Number);
    return w / h;
  };
  return [...ASPECTS].sort(
    (a, b) => Math.abs(Math.log(value(a) / ratio)) - Math.abs(Math.log(value(b) / ratio))
  )[0];
}

export const PRESETS: Record<Kind, Preset> = {
  icon: { tier: 'flash', aspect: '1:1', size: '1K', post: 'icon', suffix: ICON_FRAMING },
  token: { tier: 'flash', aspect: '1:1', size: '1K', post: 'token', suffix: TOKEN_FRAMING },
  // The aspect is replaced per call from the footprint (generate) or the source (edit).
  prop: { tier: 'flash', aspect: '1:1', size: '1K', post: 'prop', suffix: PROP_FRAMING },
  // Flash for every kind (owner rule 2026-09-19). Pro is opt-in via tier + confirmPro.
  portrait: { tier: 'flash', aspect: '3:4', size: '2K', post: 'portrait', suffix: '' },
  illustration: { tier: 'flash', aspect: '16:9', size: '4K', post: 'illustration', suffix: '' },
};

/** Finished pixel sizes the post-processors guarantee. */
export const OUTPUT = {
  icon: { width: 512, height: 512 },
  token: { width: 512, height: 512 },
  illustration: { width: 2560, height: 1600 },
} as const;

/**
 * Token square by footprint. A Foundry token image is stretched to the grid footprint, so a
 * Large-or-bigger token shows at twice a Medium's pixels or more; 1024 is the 1K render's
 * native edge, so nothing is upsampled. Two values on purpose (owner, 2026-09-24): a Tiny cat
 * still sits in one cell, so it is "medium" here.
 */
export const CREATURE_SIZES = ['medium', 'large'] as const;
export type CreatureSize = (typeof CREATURE_SIZES)[number];
export const TOKEN_EDGE: Record<CreatureSize, number> = { medium: 512, large: 1024 };

/**
 * Output filename: `<kind>-<slug>-<id>.png` (kebab-case, kind-prefixed, matching the campaign
 * repos' `art/` shelf — locked with the owner 2026-08-26, id replaces the old seed).
 */
export function filename(kind: Kind, slug: string, id: string): string {
  return `${kind}-${slugify(slug)}-${id}.png`;
}

/** Kebab-case sanitizer: lowercase, alphanumerics and hyphens only, collapsed, trimmed. */
export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`slug ${JSON.stringify(raw)} has no usable characters`);
  return slug;
}
