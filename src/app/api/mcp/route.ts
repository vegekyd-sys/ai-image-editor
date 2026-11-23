import { fixedImageBillingSku, imageAdmissionCredits } from '@/lib/billing/image-pricing';
import { normalizeImageModelId } from '@/lib/image-model-capabilities';
import { createMakaronMcpServer } from '@/mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateApiKey } from '@/lib/billing/api-keys';
import { enterBillingAttribution, resolveRequestBillingSource } from '@/lib/billing/attribution';
import { checkBalance, deductCredits, deductByTokens, isBillingEnabled, recordSubscriptionUsage, requireCredits } from '@/lib/billing/credits';
import { PricingUnavailableError } from '@/lib/billing/media-pricing';
import { resolveToolName } from '@/lib/billing/pricing';
import { deductAudioCredits, quoteAudioGeneration } from '@/lib/billing/audio';
import { getAudioModelCapability } from '@/lib/audio-model-capabilities';
import { submitMcpVideo, settleMcpVideoStatus } from '@/lib/billing/mcp-video';

export const maxDuration = 300;

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
  let creditsCharged = 0;
  const trackCharge = (result: { charged: number } | void) => {
    if (result && Number.isFinite(result.charged)) creditsCharged += result.charged;
  };
  const cli = auth.type === 'user' && resolveRequestBillingSource(req, { apiKeyId: auth.keyId }) === 'cli';
  if (auth.type === 'user') {
    // makaron-cli announces itself; other API-key callers stay 'mcp'.
    enterBillingAttribution({
      source: cli ? 'cli' : 'mcp',
      apiKeyId: auth.keyId ?? null,
    });
  }

  const server = createMakaronMcpServer({
    returnImageContent: true,
    userId: auth.userId,
    imageSignal: req.signal,
    // The existing Voice CLI speaks the ordinary edit protocol. Only explicitly enrolled
    // API-key IDs opt into permanent projects; the owner always comes from authentication.
    saveVoiceImage: cli && auth.keyId && process.env.MAKARON_VOICE_IMAGE_KEY_IDS?.split(',').some(id => id.trim() === auth.keyId)
      ? async image => {
        const { saveVoiceImageProject } = await import('@/lib/voice-image-project');
        return saveVoiceImageProject(auth.userId!, image);
      } : undefined,
    publishKlingImage4Result: auth.type === 'user' ? async (image, taskId) => {
      const { uploadImage } = await import('@/lib/supabase/storage');
      const { getSupabaseAdmin } = await import('@/lib/supabase/service');
      const url = await uploadImage(getSupabaseAdmin(), auth.userId!, 'mcp-kling-image4', `${taskId}.png`, image);
      if (!url) throw new Error('Kling Image 4.0 original could not be saved; retain the provider task and do not regenerate. No image credits were deducted.');
      return url;
    } : undefined,
    onSeedream55Receipt: auth.type === 'user' ? async receipt => {
      const { writeFile } = await import('@/lib/workspace');
      const { getSupabaseAdmin } = await import('@/lib/supabase/service');
      const saved = await writeFile(`seedream55/${receipt.taskId}.json`, JSON.stringify({ ...receipt, updatedAt: new Date().toISOString() }), getSupabaseAdmin(), auth.userId!, 'application/json');
      if (!saved.success) throw new Error('Seedream receipt persistence failed');
    } : undefined,
    submitVideo: auth.type === 'user' ? (input, toolName) => submitMcpVideo(input, { userId: auth.userId!, apiKeyId: auth.keyId!, toolName }) : undefined,
    onVideoStatus: auth.type === 'user' ? (taskId, status, queryFailed) => settleMcpVideoStatus(auth.userId!, taskId, status, queryFailed) : undefined,
    // Pre-check: ensure user has enough credits
    onToolStart: auth.type === 'user' ? async (toolName, model, meta) => {
      if (!(await isBillingEnabled())) return { allowed: true };
      if (toolName === 'makaron_edit_image') {
        const id = normalizeImageModelId(model);
        if (!id) return { allowed: false, message: 'Unknown image model.' };
        try {
          const credits = await imageAdmissionCredits(id, { ...meta, imageInputCount: meta?.imageInputCount ?? 0 });
          if (credits === 0) return { allowed: true };
          const check = await requireCredits(auth.userId!, credits);
          return check.ok ? { allowed: true } : { allowed: false, message: `Insufficient credits. Need ${credits}, have ${check.balance}.` };
        } catch (error) {
          return { allowed: false, message: error instanceof PricingUnavailableError
            ? error.message : 'Makaron pricing is not available for the selected image model.' };
        }
      }
      // Video is atomically reserved after resolving provider inputs.
      if (toolName === 'makaron_create_video' || toolName === 'makaron_edit_video' || toolName === 'makaron_upscale_video') {
        return { allowed: true };
      }
      if (toolName === 'makaron_create_audio') {
        const quote = await quoteAudioGeneration({ provider: getAudioModelCapability(model).provider, durationSeconds: 20 });
        const check = await requireCredits(auth.userId!, quote.credits);
        return check.ok ? { allowed: true } : { allowed: false, message: 'Insufficient credits.' };
      }
      if (['makaron_write_video_script', 'makaron_analyze_video'].includes(toolName)) {
        const check = await requireCredits(auth.userId!, 5);
        return check.ok ? { allowed: true } : { allowed: false, message: 'Insufficient credits.' };
      }
      const pricingName = resolveToolName(toolName, model, meta?.imageInputCount);
      const { ok, balance, cost } = await checkBalance(auth.userId!, pricingName);
      if (!ok) {
        return { allowed: false, message: `Insufficient credits. Need ${cost}, have ${balance}. Top up at https://www.makaron.app/dashboard` };
      }
      return { allowed: true };
    } : undefined,

    // Post-complete: deduct credits (token-based if usage available, else per-action)
    onToolComplete: auth.type === 'user' ? async (toolName, model, durationMs, usage, meta) => {
      // Video is already reserved; analysis charges inside its shared analyzer.
      if (['makaron_create_video', 'makaron_edit_video', 'makaron_upscale_video', 'makaron_analyze_video'].includes(toolName)) return;
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
        trackCharge(await deductByTokens(
          auth.userId!,
          toolName,
          usage.modelId,
          usage.inputTokens - (usage.cacheReadTokens ?? 0),
          usage.outputTokens,
          durationMs,
          auth.keyId,
          usage.cacheReadTokens == null ? undefined : { cacheRead: usage.cacheReadTokens, cacheWrite: 0 },
          usage.providerCostUsd,
        ));
      } else if (meta?.audioUsage) {
        trackCharge(await deductAudioCredits(auth.userId!, {
          ...meta.audioUsage,
          generationSeconds: meta.audioUsage.generationSeconds ?? (durationMs ? durationMs / 1000 : undefined),
        }, { apiKeyId: auth.keyId }));
      } else if (toolName === 'makaron_edit_image') {
        if (!(await isBillingEnabled())) return;
        const id = normalizeImageModelId(model);
        if (!id) throw new Error('Unknown image model at settlement.');
        const sku = fixedImageBillingSku(id, meta?.imagePricing ?? { imageInputCount: 0 });
        trackCharge(await deductCredits(auth.userId!, auth.keyId!, sku, id, durationMs));
      } else {
        // Other fixed-price tools.
        const pricingName = resolveToolName(toolName, model);
        trackCharge(await deductCredits(auth.userId!, auth.keyId!, pricingName, model, durationMs));
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
    // Credits charged by this request (video reservations are reported by
    // the tool result itself) plus the balance after deduction.
    headers.set('X-Credits-Charged', String(creditsCharged));
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
