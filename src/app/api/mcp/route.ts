import { createMakaronMcpServer } from '@/mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export const maxDuration = 120;

// Stateless mode: each request creates a fresh server+transport.
// Our tools (edit_image, rotate_camera) are stateless — no session needed.
async function handleMcp(req: Request): Promise<Response> {
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
