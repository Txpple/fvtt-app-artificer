import { describe, expect, it } from 'vitest';
import { Gemini, MODELS, PRICE, buildRequestBody, parseResponse } from './gemini.js';

const tinyJpegB64 = Buffer.from('not-really-a-jpeg').toString('base64');

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildRequestBody', () => {
  it('attaches images before the text, base64-encoded, and pins image-only output', () => {
    const body = buildRequestBody({
      tier: 'flash',
      prompt: 'a key',
      images: [{ data: Buffer.from('abc'), mimeType: 'image/png' }],
      aspect: '1:1',
      size: '1K',
    }) as any;
    expect(body.contents[0].parts).toEqual([
      { inline_data: { mime_type: 'image/png', data: Buffer.from('abc').toString('base64') } },
      { text: 'a key' },
    ]);
    expect(body.generationConfig).toEqual({
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
    });
  });
});

describe('parseResponse', () => {
  it('extracts the inline image and its mime type', () => {
    const r = parseResponse(
      {
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: tinyJpegB64 } }] },
          },
        ],
      },
      'm'
    );
    expect(r.image.mimeType).toBe('image/jpeg');
    expect(r.image.data.toString()).toBe('not-really-a-jpeg');
    expect(r.finishReason).toBe('STOP');
  });

  it('names a prompt block', () => {
    expect(() => parseResponse({ promptFeedback: { blockReason: 'SAFETY' } }, 'm')).toThrow(
      /blocked.*SAFETY/
    );
  });

  it('names an image-less answer with the finish reason and any text', () => {
    expect(() =>
      parseResponse(
        { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'nope' }] } }] },
        'm'
      )
    ).toThrow(/no image.*IMAGE_SAFETY.*nope/);
  });
});

describe('Gemini client', () => {
  it('refuses to call out without a key', async () => {
    const g = new Gemini({ apiKey: '', timeoutMs: 10 });
    expect(g.hasKey).toBe(false);
    await expect(
      g.generate({ tier: 'flash', prompt: 'x', aspect: '1:1', size: '1K' })
    ).rejects.toThrow(/GEMINI_API_KEY/);
    expect(await g.availableModels()).toEqual([]);
  });

  it('posts to the tier’s model with the key header and surfaces HTTP errors', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return okResponse({ error: { message: 'quota' } }, 429);
    }) as typeof fetch;
    const g = new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
    await expect(
      g.generate({ tier: 'pro', prompt: 'x', aspect: '16:9', size: '4K' })
    ).rejects.toThrow(/HTTP 429: quota/);
    expect(calls[0].url).toContain(`/models/${MODELS.pro}:generateContent`);
    expect((calls[0].init.headers as any)['x-goog-api-key']).toBe('k');
  });

  it('reports which of our two models the key can see', async () => {
    const fakeFetch = (async () =>
      okResponse({
        models: [{ name: `models/${MODELS.flash}` }, { name: 'models/other' }],
      })) as typeof fetch;
    const g = new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
    expect(await g.availableModels()).toEqual([MODELS.flash]);
  });
});

describe('price table', () => {
  it('has pro at least as expensive as flash at every size, and 4K the dearest', () => {
    for (const size of ['1K', '2K', '4K'] as const)
      expect(PRICE.pro[size]).toBeGreaterThanOrEqual(PRICE.flash[size]);
    expect(PRICE.flash['4K']).toBeGreaterThan(PRICE.flash['1K']);
    expect(PRICE.pro['4K']).toBeGreaterThan(PRICE.pro['1K']);
  });
});
