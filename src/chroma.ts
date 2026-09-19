// Chroma key selection. The key color is chosen PER TOKEN (owner rule 2026-09-19): a green goblin
// on a green plate keys badly, a purple-armoured orc on magenta keys badly. Sample the subject
// (source image for edits, reference tokens for generates), count the pixels each candidate key
// would wrongly eat, and pick the safest. Deterministic; sharp only.

import sharp from 'sharp';

export const CHROMA_KEYS = {
  green: '#00FF00',
  magenta: '#FF00FF',
  blue: '#0000FF',
} as const;
export type ChromaKey = keyof typeof CHROMA_KEYS;

const KEY_ORDER: ChromaKey[] = ['green', 'magenta', 'blue'];

/** The proven plate sentence (M0 spike), parameterised by key. Keep the structure verbatim. */
export function chromaSuffix(key: ChromaKey): string {
  return (
    `The ENTIRE image background, edge to edge and corner to corner, is one flat uniform ` +
    `chroma-key ${key} (${CHROMA_KEYS[key]}) with no circle, no disc, no ring, no border, ` +
    `no ground, no shadow; only the figure and the flat ${key}.`
  );
}

/**
 * Channel-dominance tests mirroring the cutout script's own key metrics, so "would be keyed"
 * here means the same thing it does in the script. Threshold 40 ≈ the script's floor.
 */
function dominance(key: ChromaKey, r: number, g: number, b: number): number {
  switch (key) {
    case 'green':
      return g - Math.max(r, b);
    case 'blue':
      return b - Math.max(r, g);
    case 'magenta':
      return Math.min(r, b) - g;
  }
}

export interface KeyScore {
  key: ChromaKey;
  /** Fraction of opaque sampled pixels the key would (partly) eat. Lower is safer. */
  risk: number;
}

/** Score every candidate key against one image's opaque pixels. */
export async function scoreKeys(image: Buffer): Promise<KeyScore[]> {
  const { data, info } = await sharp(image)
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts: Record<ChromaKey, number> = { green: 0, magenta: 0, blue: 0 };
  let opaque = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] ?? 255;
    if (a < 128) continue;
    opaque++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    for (const key of KEY_ORDER) if (dominance(key, r, g, b) > 40) counts[key]++;
  }
  return KEY_ORDER.map(key => ({ key, risk: opaque ? counts[key] / opaque : 0 }));
}

/**
 * Pick the safest key across all sample images (worst case per key wins). Ties keep the fixed
 * order green → magenta → blue, so green stays the default when nothing argues against it.
 */
export async function pickChromaKey(samples: Buffer[]): Promise<ChromaKey> {
  if (samples.length === 0) return 'green';
  const worst: Record<ChromaKey, number> = { green: 0, magenta: 0, blue: 0 };
  for (const s of samples) {
    for (const { key, risk } of await scoreKeys(s)) worst[key] = Math.max(worst[key], risk);
  }
  let best: ChromaKey = 'green';
  for (const key of KEY_ORDER) if (worst[key] < worst[best]) best = key;
  return best;
}
