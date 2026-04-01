import { createMakaronMcpServer } from '@/mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateApiKey } from '@/lib/billing/api-keys';
import { checkBalance, deductCredits } from '@/lib/billing/credits';
import { resolveToolName } from '@/lib/billing/pricing';

export const maxDuration = 180;

interface AuthResult {
  type: 'user' | 'legacy' | 'none';
  userId?: string;
  keyId?: string;
}

async function checkAuth(req: Request): Promise<{ error?: Response; auth: AuthResult }> {
  const header = req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    // No token — check if dev mode (no MCP_API_KEY configured)
    if (!process.env.MCP_API_KEY) return { auth: { type: 'none' } };
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
      auth: { type: 'none' },
    };
  }

  // Try per-user API key first (mk_live_xxx)
  if (token.startsWith('mk_live_')) {
    const result = await validateApiKey(token);
    if (result) return { auth: { type: 'user', userId: result.userId, keyId: result.keyId } };
    return {
      error: new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
      auth: { type: 'none' },
    };
  }

  // Fallback: legacy MCP_API_KEY (no billing)
  if (process.env.MCP_API_KEY && token === process.env.MCP_API_KEY) {
    return { auth: { type: 'legacy' } };
  }

  return {
    error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    auth: { type: 'none' },
  };
}

async function handleMcp(req: Request): Promise<Response> {
  const { error: authError, auth } = await checkAuth(req);
  if (authError) return authError;

  // Track billing context for this request
  let lastToolModel: string | undefined;

  const server = createMakaronMcpServer({
    // Pre-check: ensure user has enough credits
    onToolStart: auth.type === 'user' ? async (toolName) => {
      const pricingName = resolveToolName(toolName, undefined); // model unknown at start, use base name
      const { ok, balance, cost } = await checkBalance(auth.userId!, pricingName);
      if (!ok) {
        return { allowed: false, message: `Insufficient credits. Need ${cost}, have ${balance}. Top up at https://www.makaron.app/dashboard` };
      }
      return { allowed: true };
    } : undefined,

    // Post-complete: deduct credits
    onToolComplete: auth.type === 'user' ? async (toolName, model, durationMs) => {
      lastToolModel = model;
      await deductCredits(auth.userId!, auth.keyId!, toolName, model, durationMs);
    } : undefined,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(req);

  // Add billing headers for user keys
  if (auth.type === 'user') {
    const headers = new Headers(response.headers);
    // Get updated balance (after deduction)
    try {
      const { checkBalance: cb } = await import('@/lib/billing/credits');
      const { balance } = await cb(auth.userId!, 'noop');
      headers.set('X-Credits-Remaining', String(balance));
    } catch { /* ignore */ }
    return new Response(response.body, { status: response.status, headers });
  }

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
