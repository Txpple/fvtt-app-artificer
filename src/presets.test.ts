import { describe, expect, it } from 'vitest';
import {
  KINDS,
  PRESETS,
  PROP_FRAMING,
  TOKEN_EDGE,
  TOKEN_FRAMING,
  filename,
  nearestAspect,
  parseFootprint,
  slugify,
} from './presets.js';

describe('presets', () => {
  it('locks the tier, aspect, and size per kind as decided 2026-09-19', () => {
    expect(PRESETS.icon).toMatchObject({ tier: 'flash', aspect: '1:1', size: '1K', post: 'icon' });
    expect(PRESETS.token).toMatchObject({
      tier: 'flash',
      aspect: '1:1',
      size: '1K',
      post: 'token',
    });
    expect(PRESETS.portrait).toMatchObject({
      tier: 'flash',
      aspect: '3:4',
      size: '2K',
      post: 'portrait',
    });
    expect(PRESETS.illustration).toMatchObject({
      tier: 'flash',
      aspect: '16:9',
      size: '4K',
      post: 'illustration',
    });
  });

  it('has five kinds and no map kind (props are dressing, not map layers)', () => {
    expect([...KINDS].sort()).toEqual(['icon', 'illustration', 'portrait', 'prop', 'token']);
  });

  it('frames tokens top-down and leaves the plate sentence to chroma.ts', () => {
    expect(PRESETS.token.suffix).toBe(TOKEN_FRAMING);
    expect(PRESETS.token.suffix).toMatch(/top-down/);
    // Both body plans: humanoids face up, beasts are seen along the back, head not turned up.
    expect(PRESETS.token.suffix).toMatch(/upright figure.*face tilts up toward the viewer/);
    expect(PRESETS.token.suffix).toMatch(/four-legged.*spine faces the camera.*not turned up/);
    expect(PRESETS.token.suffix).not.toMatch(/chroma/);
  });

  it('never appends framing to portraits or illustrations', () => {
    expect(PRESETS.portrait.suffix).toBe('');
    expect(PRESETS.illustration.suffix).toBe('');
  });
});

describe('props', () => {
  it('frame straight down, object only, never a figure or a face', () => {
    expect(PRESETS.prop.suffix).toBe(PROP_FRAMING);
    expect(PROP_FRAMING).toMatch(/directly above.*straight down/);
    expect(PROP_FRAMING).toMatch(/no people, no creatures, no figures, no faces/);
    expect(PROP_FRAMING).not.toMatch(/hair|tilts up/);
    expect(PROP_FRAMING).toMatch(/nothing touches or crosses the edge/);
  });

  it('parse a footprint and refuse nonsense', () => {
    expect(parseFootprint('2x1')).toEqual({ w: 2, h: 1 });
    expect(parseFootprint(' 13X5 ')).toEqual({ w: 13, h: 5 });
    for (const bad of ['0x1', '2', 'x', '21x1', '2 by 1']) {
      expect(() => parseFootprint(bad)).toThrow(/footprint/);
    }
  });

  it('pick the nearest API aspect for a footprint', () => {
    expect(nearestAspect(1)).toBe('1:1');
    expect(nearestAspect(2)).toBe('16:9');
    expect(nearestAspect(0.5)).toBe('9:16');
    expect(nearestAspect(1.5)).toBe('3:2');
    expect(nearestAspect(3 / 4)).toBe('3:4');
  });
});

describe('TOKEN_EDGE', () => {
  it('is two values: one-cell tokens at 512, Large and up at the native 1024', () => {
    expect(TOKEN_EDGE).toEqual({ medium: 512, large: 1024 });
  });
});

describe('filename', () => {
  it('builds <kind>-<slug>-<id>.png in the locked convention', () => {
    expect(filename('illustration', "Smugglers' COVE", 'a1b2c3d4')).toBe(
      'illustration-smugglers-cove-a1b2c3d4.png'
    );
  });

  it('sanitizes arbitrary slugs to kebab-case', () => {
    expect(slugify('--a--b--')).toBe('a-b');
  });

  it('rejects slugs with no usable characters', () => {
    expect(() => slugify('!!!')).toThrow(/no usable characters/);
  });
});
