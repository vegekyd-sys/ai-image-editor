import { createMakaronMcpServer } from '@/mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateApiKey } from '@/lib/billing/api-keys';
import { checkBalance, deductCredits, deductByTokens, isBillingEnabled, recordSubscriptionUsage, requireCredits } from '@/lib/billing/credits';
import { resolveToolName } from '@/lib/billing/pricing';
import { deductSeedAudioCredits } from '@/lib/billing/seed-audio';
import { submitMcpVideo, settleMcpVideoStatus } from '@/lib/billing/mcp-video';
import { quoteSeedAudio } from '@/lib/billing/media-pricing';

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

  const server = createMakaronMcpServer({
    userId: auth.userId,
    submitVideo: auth.type === 'user' ? (input, toolName) => submitMcpVideo(input, { userId: auth.userId!, apiKeyId: auth.keyId!, toolName }) : undefined,
    onVideoStatus: auth.type === 'user' ? (taskId, status, queryFailed) => settleMcpVideoStatus(auth.userId!, taskId, status, queryFailed) : undefined,
    // Pre-check: ensure user has enough credits
    onToolStart: auth.type === 'user' ? async (toolName, model) => {
      if (!(await isBillingEnabled())) return { allowed: true };
      // Video is atomically reserved after resolving provider inputs.
      if (toolName === 'makaron_create_video' || toolName === 'makaron_edit_video') {
        return { allowed: true };
      }
      if (toolName === 'makaron_create_seed_audio') {
        const quote = await quoteSeedAudio({ durationSeconds: 20 });
        const check = await requireCredits(auth.userId!, quote.credits);
        return check.ok ? { allowed: true } : { allowed: false, message: 'Insufficient credits.' };
      }
      if (['makaron_write_video_script', 'makaron_analyze_video'].includes(toolName)
        || (toolName === 'makaron_edit_image' && !['qwen', 'pony', 'wai', 'wan2.7-image'].includes(model ?? ''))) {
        const check = await requireCredits(auth.userId!, 5);
        return check.ok ? { allowed: true } : { allowed: false, message: 'Insufficient credits.' };
      }
      const pricingName = resolveToolName(toolName, model);
      const { ok, balance, cost } = await checkBalance(auth.userId!, pricingName);
      if (!ok) {
        return { allowed: false, message: `Insufficient credits. Need ${cost}, have ${balance}. Top up at https://www.makaron.app/dashboard` };
      }
      return { allowed: true };
    } : undefined,

    // Post-complete: deduct credits (token-based if usage available, else per-action)
    onToolComplete: auth.type === 'user' ? async (toolName, model, durationMs, usage, meta) => {
      // Video is already reserved; analysis charges inside its shared analyzer.
      if (['makaron_create_video', 'makaron_edit_video', 'makaron_analyze_video'].includes(toolName)) return;
      const usageSubscriptionProvider = usage?.provider === 'codex-subscription'
        || usage?.provider === 'grok-subscription'
        ? usage.provider
        : undefined;
      if (usage && usageSubscriptionProvider) {
        try {
          await recordSubscriptionUsage(
            auth.userId!,
            usageSubscriptionProvider,
            toolName,
            usage.modelId,
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              durationMs,
              apiKeyId: auth.keyId,
            },
          );
        } catch (error) {
          console.error('[billing] MCP subscription usage logging error:', error);
        }
      } else if (meta?.provider === 'grok-subscription') {
        try {
          await recordSubscriptionUsage(
            auth.userId!,
            'grok-subscription',
            toolName,
            model || meta.videoModel || 'grok',
            { durationMs, apiKeyId: auth.keyId },
          );
        } catch (error) {
          console.error('[billing] MCP subscription usage logging error:', error);
        }
      } else if (usage) {
        // Token-based billing — Gemini/OpenRouter tools that return usage
        await deductByTokens(
          auth.userId!,
          toolName,
          usage.modelId,
          usage.inputTokens - (usage.cacheReadTokens ?? 0),
          usage.outputTokens,
          durationMs,
          auth.keyId,
          usage.cacheReadTokens == null ? undefined : { cacheRead: usage.cacheReadTokens, cacheWrite: 0 },
          usage.providerCostUsd,
        );
      } else if (meta?.seedAudioDurationSec || meta?.seedAudioProviderCredits) {
        await deductSeedAudioCredits(auth.userId!, {
          durationSeconds: meta.seedAudioDurationSec,
          providerCreditsUsed: meta.seedAudioProviderCredits,
          model,
          generationSeconds: meta.seedAudioGenerationSec ?? (durationMs ? durationMs / 1000 : undefined),
          apiKeyId: auth.keyId,
        });
      } else {
        // Per-action billing — ComfyUI, Suno etc.
        await deductCredits(auth.userId!, auth.keyId!, toolName, model, durationMs);
      }
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
      const { getBalance } = await import('@/lib/billing/credits');
      const { balance } = await getBalance(auth.userId!);
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
