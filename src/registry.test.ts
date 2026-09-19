import { describe, expect, it } from 'vitest';
import { Gemini } from './gemini.js';
import { buildToolRegistry } from './registry.js';
import { SpendMeter } from './spend.js';

function build() {
  const gemini = new Gemini({ apiKey: '', timeoutMs: 1 });
  return buildToolRegistry({ gemini, spend: new SpendMeter(), outputDir: 'x' });
}

describe('tool registry', () => {
  it('advertises exactly the three-tool surface, one definition per handler', () => {
    const { tools, handlers } = build();
    expect(tools.map(t => t.name).sort()).toEqual([
      'artificer-status',
      'edit-image',
      'generate-image',
    ]);
    expect(Object.keys(handlers).sort()).toEqual(tools.map(t => t.name).sort());
  });

  it('advertises draft-2020-12-safe object schemas (no $schema, object root, properties present)', () => {
    for (const tool of build().tools) {
      expect(tool.inputSchema.$schema).toBeUndefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeTypeOf('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('rejects unknown tool names at dispatch', async () => {
    await expect(build().dispatch('nope', {})).rejects.toThrow(/Unknown tool/);
  });

  it('validates arguments through the zod contract before any network traffic', async () => {
    await expect(
      build().dispatch('generate-image', { kind: 'poster', prompt: 'x', slug: 'x' })
    ).rejects.toThrow();
  });
});
