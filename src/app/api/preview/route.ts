import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/model-router';
import { generateTipsPreviewImageOpenRouter } from '@/lib/gemini';
import { requireCredits, deductByTokens, deductCredits } from '@/lib/billing/credits';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(user.id, 2);
    if (!creditCheck.ok) return creditCheck.response;

    const { image, editPrompt, aspectRatio, background, category, isNsfw } = await req.json();

    if (!image || !editPrompt) {
      return new Response(
        JSON.stringify({ error: 'image and editPrompt are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (background !== undefined && !['auto', 'opaque', 'transparent'].includes(background)) {
      return new Response(
        JSON.stringify({ error: 'background must be auto, opaque, or transparent' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Mock mode: return original image unchanged (saves API cost for tip thumbnails)
    if (process.env.MOCK_AI === 'true') {
      return new Response(
        JSON.stringify({ image }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    let liteResult: Awaited<ReturnType<typeof generateTipsPreviewImageOpenRouter>> = { image: null };
    if (background !== 'transparent') {
      try {
        liteResult = await generateTipsPreviewImageOpenRouter(image, editPrompt, aspectRatio);
      } catch (error) {
        console.warn('[preview] Lite preview failed, falling back to model-router:', error);
      }
    }
    const result = liteResult.image
      ? { image: liteResult.image, model: 'gemini' as const, fallbackUsed: false, contentBlocked: undefined, usage: liteResult.usage }
      : await generateImage({ image, prompt: editPrompt, aspectRatio, background, category, isNsfw });

    // Deduct credits regardless of success (API tokens already consumed)
    if (result.usage) {
      deductByTokens(
        user.id,
        'preview',
        result.usage.modelId,
        result.usage.inputTokens,
        result.usage.outputTokens,
        undefined,
        undefined,
        undefined,
        'providerCostUsd' in result.usage ? result.usage.providerCostUsd : undefined,
      )
        .catch(e => console.error('[billing] preview deduct error:', e));
    } else if (result.image) {
      // Only charge per-action if image was actually generated (ComfyUI or no-usage Gemini)
      const toolName = result.model === 'gemini' ? 'preview' : `edit_image_${result.model}`;
      deductCredits(user.id, null, toolName)
        .catch(e => console.error('[billing] preview deduct error:', e));
    }

    if (!result.image) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate preview' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ image: result.image, contentBlocked: result.contentBlocked }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Preview API error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate preview' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
