// The tool registry — the single place tool names, definitions, and handlers are wired together
// (pattern inherited from fvtt-mcp-dnd5e). The `handlers` map is the source of truth; the
// advertised `tools` list is DERIVED from it, so the two cannot drift, and a handler without a
// matching definition fails fast at startup.

import { CutoutImageTool } from './tools/cutout.js';
import { EditImageTool } from './tools/edit.js';
import { GenerateImageTool } from './tools/generate.js';
import type { ToolDeps } from './tools/shared.js';
import { StatusTool } from './tools/status.js';

export interface ToolRegistry {
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  handlers: Record<string, (args: unknown) => Promise<unknown>>;
  dispatch(name: string, args: unknown): Promise<unknown>;
}

export function buildToolRegistry(deps: ToolDeps): ToolRegistry {
  const generate = new GenerateImageTool(deps);
  const edit = new EditImageTool(deps);
  const cutout = new CutoutImageTool(deps);
  const status = new StatusTool(deps);

  const handlers: ToolRegistry['handlers'] = {
    'generate-image': args => generate.handleGenerateImage(args),
    'edit-image': args => edit.handleEditImage(args),
    'cutout-image': args => cutout.handleCutoutImage(args),
    'artificer-status': args => status.handleStatus(args),
  };

  const definitions = [
    ...generate.getToolDefinitions(),
    ...edit.getToolDefinitions(),
    ...cutout.getToolDefinitions(),
    ...status.getToolDefinitions(),
  ];

  const tools = Object.keys(handlers).map(name => {
    const def = definitions.find(d => d.name === name);
    if (!def) throw new Error(`handler ${name} has no advertised tool definition`);
    return def;
  });
  for (const def of definitions) {
    if (!(def.name in handlers)) throw new Error(`definition ${def.name} has no handler`);
  }

  return {
    tools,
    handlers,
    dispatch(name, args) {
      const handler = handlers[name];
      if (!handler) return Promise.reject(new Error(`Unknown tool: ${name}`));
      return handler(args);
    },
  };
}
