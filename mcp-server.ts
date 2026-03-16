// .md files are handled by md-loader.cjs (preloaded via --require flag)
// Run with: npx tsx --require ./md-loader.cjs mcp-server.ts [--stdio]

import { config } from 'dotenv';
import { join } from 'path';
const ROOT = __dirname;
config({ path: join(ROOT, '.env.local') });
config({ path: join(ROOT, '.env') }); // fallback
import { createMakaronMcpServer } from './src/mcp/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';

const server = createMakaronMcpServer();

const useStdio = process.argv.includes('--stdio');

if (useStdio) {
  // stdio mode — for local MCP clients (Claude Code, etc.)
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('Makaron MCP Server running (stdio)');
  });
} else {
  // HTTP mode — for remote MCP clients (video-maker, etc.)
  const PORT = parseInt(process.env.MCP_PORT || '3100', 10);

  const httpServer = createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/mcp') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: ['makaron_edit_image', 'makaron_rotate_camera'] }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`Makaron MCP Server running on http://localhost:${PORT}/mcp`);
  });
}
