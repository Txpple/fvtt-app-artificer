import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Gemini } from '../gemini.js';
import { buildToolRegistry } from '../registry.js';
import { SpendMeter } from '../spend.js';
import { EDIT_PREAMBLE } from './edit.js';
import { referencePreamble, resolveTier } from './shared.js';

let tmp: string;
let refPng: string;
let sent: Array<{ url: string; body: any }>;

function fakeGemini(width = 1024, height = 1024): Gemini {
  sent = [];
  const fakeFetch = (async (url: any, init: any) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    const data = (
      await sharp({ create: { width, height, channels: 3, background: '#00ff00' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
}

function build(gemini = fakeGemini()) {
  const spend = new SpendMeter();
  return { spend, ...buildToolRegistry({ gemini, spend, outputDir: tmp }) };
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-test-'));
  refPng = path.join(tmp, 'ref.png');
  fs.writeFileSync(
    refPng,
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
  );
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the Pro cost gate', () => {
  it('refuses pro kinds without confirmPro and states the cost and both ways out', () => {
    expect(() => resolveTier('illustration', undefined, undefined)).toThrow(
      /pro tier.*\$0\.24.*confirmPro: true.*tier: "flash"/s
    );
    expect(() => resolveTier('portrait', undefined, false)).toThrow(/\$0\.13/);
  });

  it('lets flash kinds through, honours an explicit flash override, and accepts a confirmed pro call', () => {
    expect(resolveTier('icon', undefined, undefined)).toBe('flash');
    expect(resolveTier('illustration', 'flash', undefined)).toBe('flash');
    expect(resolveTier('illustration', undefined, true)).toBe('pro');
    expect(() => resolveTier('icon', 'pro', undefined)).toThrow(/pro tier/);
  });
});

describe('referencePreamble', () => {
  it('numbers references 1-based, labels them, and separates character from style roles', () => {
    const s = referencePreamble([
      { path: 'a', role: 'character', label: 'Morgash' },
      { path: 'b', role: 'style' },
    ]);
    expect(s).toMatch(/^Image 1 \(Morgash\) is a CHARACTER reference/);
    expect(s).toMatch(/Image 2 is a STYLE reference only/);
    expect(referencePreamble([])).toBe('');
  });
});

describe('generate-image', () => {
  it('writes a finished PNG named <kind>-<slug>-<id>.png, appends the preset suffix, and meters spend', async () => {
    const { dispatch, spend } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'icon',
      prompt: 'a rusted iron key',
      slug: 'Rusted Key!',
    });
    expect(path.basename(r.file)).toMatch(/^icon-rusted-key-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(r.file)).toBe(true);
    expect(r).toMatchObject({
      kind: 'icon',
      tier: 'flash',
      width: 512,
      height: 512,
      estimatedUsd: 0.067,
    });
    expect(spend.totalUsd).toBe(0.067);
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toMatch(/^a rusted iron key Inventory icon/);
    expect(sent[0].url).toContain('gemini-3.1-flash-image');
  });

  it('appends the chroma plate to tokens and attaches references ahead of the text', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a goblin scout',
      slug: 'goblin',
      references: [{ path: refPng, role: 'style', label: 'Morgash token' }],
    });
    const parts = sent[0].body.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].inline_data.mime_type).toBe('image/png');
    expect(parts[1].text).toMatch(/^Image 1 \(Morgash token\) is a STYLE reference/);
    expect(parts[1].text).toContain('chroma-key green (#00FF00)');
    expect(r.width).toBe(1024);
  });

  it('crops a confirmed pro illustration to 2560×1600 at the pro price', async () => {
    const { dispatch } = build(fakeGemini(4096, 2304));
    const r: any = await dispatch('generate-image', {
      kind: 'illustration',
      prompt: 'an inn',
      slug: 'inn',
      confirmPro: true,
    });
    expect(r).toMatchObject({ tier: 'pro', width: 2560, height: 1600, estimatedUsd: 0.24 });
    expect(sent[0].body.generationConfig.imageConfig).toEqual({
      aspectRatio: '16:9',
      imageSize: '4K',
    });
    expect(sent[0].url).toContain('gemini-3-pro-image');
  });

  it('refuses a pro kind before any network call', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('generate-image', { kind: 'portrait', prompt: 'x', slug: 'x' })
    ).rejects.toThrow(/confirmPro/);
    expect(sent).toHaveLength(0);
  });

  it('fails on a missing reference file before any network call', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('generate-image', {
        kind: 'icon',
        prompt: 'x',
        slug: 'x',
        references: [{ path: path.join(tmp, 'nope.png'), role: 'style' }],
      })
    ).rejects.toThrow(/not found/);
    expect(sent).toHaveLength(0);
  });
});

describe('edit-image', () => {
  it('attaches the source first, defaults to flash for any kind, and shifts reference numbering', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'swap the sword for a maul',
      kind: 'token',
      slug: 'morgash',
      references: [{ path: refPng, role: 'style' }],
    });
    const parts = sent[0].body.contents[0].parts;
    expect(parts).toHaveLength(3);
    const text = parts[2].text;
    expect(text.startsWith(EDIT_PREAMBLE)).toBe(true);
    expect(text).toContain('Image 2 is a STYLE reference');
    expect(text).toContain('Instruction: swap the sword for a maul');
    expect(text).toContain('chroma-key green');
    expect(r.tier).toBe('flash');
    expect(path.basename(r.file)).toMatch(/^token-morgash-[0-9a-f]{8}\.png$/);
  });

  it('still gates an explicit pro edit', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('edit-image', {
        sourceImage: refPng,
        instruction: 'x',
        kind: 'portrait',
        slug: 'x',
        tier: 'pro',
      })
    ).rejects.toThrow(/confirmPro/);
  });
});

describe('artificer-status', () => {
  it('reports key presence, model reachability, output dir, and spend', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.1-flash-image' }] }), {
        status: 200,
      })) as typeof fetch;
    const gemini = new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
    const { dispatch } = build(gemini);
    const s: any = await dispatch('artificer-status', {});
    expect(s).toMatchObject({
      keyPresent: true,
      models: { flash: true, pro: false },
      outputDir: tmp,
    });
    expect(s.spend).toEqual({ calls: 0, estimatedUsd: 0, byTier: { flash: 0, pro: 0 } });
  });

  it('says so when the key is missing without calling out', async () => {
    const { dispatch } = build(new Gemini({ apiKey: '', timeoutMs: 1 }));
    const s: any = await dispatch('artificer-status', {});
    expect(s.keyPresent).toBe(false);
    expect(s.models).toEqual({});
  });
});
