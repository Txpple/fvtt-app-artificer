import { z } from 'zod';

/**
 * Single source of truth → advertised contract (inherited verbatim from fvtt-mcp-dnd5e).
 *
 * Each tool declares its input contract ONCE as a zod schema (used by the handler to
 * parse/validate); this helper derives the advertised JSON Schema from that same schema, so the
 * advertised and enforced contracts cannot diverge.
 *
 * - `io: 'input'` — describe what callers may SEND; `.default()` fields stay optional.
 * - `target: 'draft-2020-12'` — the dialect the Anthropic API validates tool input_schema
 *   against; anything else risks bricking the session when the tool list loads.
 * - `unrepresentable: 'any'` — never throw at module-load time on an exotic construct.
 */
export function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  delete json.$schema;
  stripIntSentinels(json);
  if (!Array.isArray(json.required)) json.required = [];
  if (typeof json.properties !== 'object' || json.properties === null) json.properties = {};

  return json;
}

// zod's `.int()` emits the JS safe-integer range as explicit min/max bounds. They convey no real
// constraint and just clutter the advertised schema, so drop them wherever they appear.
function stripIntSentinels(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) stripIntSentinels(child);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.maximum === Number.MAX_SAFE_INTEGER) delete obj.maximum;
    if (obj.minimum === -Number.MAX_SAFE_INTEGER) delete obj.minimum;
    for (const key of Object.keys(obj)) stripIntSentinels(obj[key]);
  }
}
