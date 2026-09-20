import { describe, expect, it } from 'vitest';
import { KINDS, PRESETS, TOKEN_FRAMING, filename, slugify } from './presets.js';

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

  it('has exactly four kinds and no map kind', () => {
    expect([...KINDS].sort()).toEqual(['icon', 'illustration', 'portrait', 'token']);
  });

  it('frames tokens top-down and leaves the plate sentence to chroma.ts', () => {
    expect(PRESETS.token.suffix).toBe(TOKEN_FRAMING);
    expect(PRESETS.token.suffix).toMatch(/top-down/);
    expect(PRESETS.token.suffix).not.toMatch(/chroma/);
  });

  it('never appends framing to portraits or illustrations', () => {
    expect(PRESETS.portrait.suffix).toBe('');
    expect(PRESETS.illustration.suffix).toBe('');
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
