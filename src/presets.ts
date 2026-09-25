// Purpose presets — the tool surface speaks `kind`, never raw dimensions or model ids. Each kind
// fixes the tier, the API aspect and size, the framing text the server appends to every prompt,
// and the post-processing that turns the API's JPEG into the finished PNG.

import type { Aspect, ImageSize, Tier } from './gemini.js';

export const KINDS = ['icon', 'token', 'portrait', 'illustration'] as const;
export type Kind = (typeof KINDS)[number];

export type Post = 'icon' | 'token' | 'portrait' | 'illustration';

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

export const TOKEN_FRAMING =
  'Virtual tabletop token, top-down: the camera is high above and slightly in front of the ' +
  'figure, about fifteen degrees off vertical, never straight down and never a three-quarter ' +
  'view. The top of the head and the shoulders are the largest shapes, the torso is ' +
  'foreshortened, the feet are mostly hidden beneath the body, and the face tilts up toward the ' +
  'viewer. If a token is attached as a style reference, match its camera pitch exactly. A ' +
  'single figure, centered, filling the frame.';

export const ICON_FRAMING =
  'Inventory icon: a single subject centered and filling the frame, no text, no border, no frame.';

export const PRESETS: Record<Kind, Preset> = {
  icon: { tier: 'flash', aspect: '1:1', size: '1K', post: 'icon', suffix: ICON_FRAMING },
  token: { tier: 'flash', aspect: '1:1', size: '1K', post: 'token', suffix: TOKEN_FRAMING },
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
