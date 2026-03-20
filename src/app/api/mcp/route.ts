import { createMakaronMcpServer } from '@/mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export const maxDuration = 120;

function checkAuth(req: Request): Response | null {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) return null; // no key configured → open access (dev mode)
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${apiKey}`) return null; // valid
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Stateless mode: each request creates a fresh server+transport.
// Our tools (edit_image, rotate_camera) are stateless — no session needed.
async function handleMcp(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;
  const server = createMakaronMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,      // JSON response instead of SSE (simpler for serverless)
  });

  await server.connect(transport);
  const response = await transport.handleRequest(req);
  return response;
}

export async function POST(req: Request) {
  return handleMcp(req);
}

export async function GET(req: Request) {
  return handleMcp(req);
}

export async function DELETE(req: Request) {
  return handleMcp(req);
}
