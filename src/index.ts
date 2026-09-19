#!/usr/bin/env node

// The MCP server entry point: a single stdio process serving the registry's tools. All network
// traffic goes through the `Gemini` seam (src/gemini.ts); tools/list answers without touching it.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { config } from './config.js';
import { Gemini } from './gemini.js';
import { buildToolRegistry } from './registry.js';
import { SpendMeter } from './spend.js';

async function main(): Promise<void> {
  const gemini = new Gemini({ apiKey: config.geminiApiKey, timeoutMs: config.timeoutMs });
  const spend = new SpendMeter();
  const { tools, dispatch } = buildToolRegistry({ gemini, spend, outputDir: config.outputDir });

  const mcp = new Server(
    { name: config.server.name, version: config.server.version },
    { capabilities: { tools: {} } }
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  mcp.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatch(name, args ?? {});
      return {
        content: [
          { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
        ],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[artificer] tool ${name} failed: ${message}`);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const shutdown = (): void => process.exit(0);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);

  // stdout is the JSON-RPC channel; diagnostics go to stderr only.
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[artificer] unhandled rejection:', reason);
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error(`[artificer] MCP server v${config.server.version} connected over stdio`);
}

main().catch(err => {
  console.error('fvtt-mcp-artificer failed to start:', err);
  process.exit(1);
});
