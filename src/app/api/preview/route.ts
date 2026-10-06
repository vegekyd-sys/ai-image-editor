import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/model-router';
import { generateTipsPreviewImageOpenRouter, TIPS_PREVIEW_IMAGE_MODEL } from '@/lib/gemini';
import { NanoBanana21RequestError, NANO_BANANA_21_MODEL } from '@/lib/models/nano-banana-21';
import { requireCredits, deductByTokens, deductCredits, isBillingEnabled } from '@/lib/billing/credits';
import { getTokenRate } from '@/lib/billing/token-rates';
import { getToolPrice } from '@/lib/billing/pricing';
import { FREE_MEDIA_ENABLED } from '@/lib/free-media-policy';

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
    if (isNsfw && background === 'transparent') {
      return Response.json({ error: 'NSFW transparent editing is not supported by Qwen Spicy.' }, { status: 400 });
    }

    const transparent = background === 'transparent';
    const spicyFirst = !transparent && (isNsfw === true || category === 'enhance');
    const nano21Preview = TIPS_PREVIEW_IMAGE_MODEL === NANO_BANANA_21_MODEL;
    if (transparent && await isBillingEnabled()) {
      const rate = await getTokenRate('gpt-image-2.5-flare');
      if (!rate || !Number.isFinite(rate.markup) || rate.markup <= 0) {
        return Response.json({ error: 'GPT Image 2.5 pricing is not configured.', code: 'pricing_unavailable' }, { status: 503 });
      }
      const check = await requireCredits(user.id, 5);
      if (!check.ok) return check.response;
    } else if (!transparent && !spicyFirst && nano21Preview && await isBillingEnabled()) {
      const rate = await getTokenRate(NANO_BANANA_21_MODEL);
      if (!rate || rate.model_id !== NANO_BANANA_21_MODEL || !Number.isFinite(rate.markup) || rate.markup <= 0) {
        return Response.json({ error: 'Nano Banana 2.1 pricing is not configured.', code: 'pricing_unavailable' }, { status: 503 });
      }
      const check = await requireCredits(user.id, Math.ceil((0.0336 + 1120 * 1.5 / 1_000_000) * rate.markup / 0.01));
      if (!check.ok) return check.response;
    } else if (!transparent) {
      // The first provider determines the initial quote. A failed Lite attempt
      // gets a separate Spicy preflight before the more expensive fallback.
      const toolName = spicyFirst ? 'edit_image_qwen-spicy' : 'preview';
      const price = await getToolPrice(toolName);
      if (!price) return Response.json({ error: `${toolName} pricing is unavailable`, code: 'pricing_unavailable' }, { status: 503 });
      const check = await requireCredits(user.id, price.isFree ? 0 : price.credits);
      if (!check.ok) return check.response;
    }

    // Mock only the provider. The free-media acceptance path still bills and delivers normally.
    if (process.env.MOCK_AI === 'true') {
      if (FREE_MEDIA_ENABLED) await deductCredits(user.id, null, 'preview');
      return Response.json({ image });
    }

    let liteResult: Awaited<ReturnType<typeof generateTipsPreviewImageOpenRouter>> = { image: null };
    let previewBlocked = false;
    if (!spicyFirst && !transparent) {
      try {
        liteResult = await generateTipsPreviewImageOpenRouter(image, editPrompt, aspectRatio);
        if (nano21Preview && !liteResult.image) throw new NanoBanana21RequestError('Nano Banana 2.1 returned no image.');
      } catch (error) {
        if (nano21Preview && !(error instanceof NanoBanana21RequestError && error.contentBlocked)) {
          return Response.json({ error: 'Preview did not complete. Do not retry automatically.', code: 'preview_generation_failed' }, { status: 503 });
        }
        previewBlocked = nano21Preview;
        console.warn('[preview] Preview rejected; checking Spicy fallback:', error);
      }
    }
    if (!liteResult.image && !spicyFirst && !transparent) {
      // generateImage may fall back from Gemini to Spicy. Never submit that
      // paid fallback using only the cheaper Lite preview balance check.
      const spicyPrice = await getToolPrice('edit_image_qwen-spicy');
      if (!spicyPrice) return Response.json({ error: 'Qwen Spicy pricing is unavailable', code: 'pricing_unavailable' }, { status: 503 });
      const check = await requireCredits(user.id, spicyPrice.isFree ? 0 : spicyPrice.credits);
      if (!check.ok) return check.response;
    }
    const result = liteResult.image
      ? { image: liteResult.image, model: nano21Preview ? 'gemini-2.1' as const : 'gemini' as const, fallbackUsed: false, contentBlocked: undefined, usage: liteResult.usage }
      : await generateImage({ image, prompt: editPrompt, aspectRatio, background, category, isNsfw, ...(!spicyFirst && !transparent ? { model: 'qwen-spicy' as const } : {}) });

    // Do not return a generated image until its debit and usage log commit.
    // Token usage can be billable even when the provider returned no image.
    try {
      if (result.usage) {
        await deductByTokens(
          user.id,
          'preview',
          result.usage.modelId,
          result.usage.inputTokens,
          result.usage.outputTokens,
          undefined,
          undefined,
          undefined,
          'providerCostUsd' in result.usage ? result.usage.providerCostUsd : undefined,
        );
      } else if (result.image) {
        const toolName = result.model === 'gemini' ? 'preview' : `edit_image_${result.model}`;
        await deductCredits(user.id, null, toolName);
      }
    } catch (error) {
      console.error('[billing] preview reconciliation required after provider response:', error);
      return Response.json({
        error: 'Preview generation completed, but billing could not be confirmed. Do not retry automatically.',
        code: 'billing_reconciliation_required',
      }, { status: 503 });
    }

    if (!result.image) {
      const transparentUnavailable = background === 'transparent';
      return new Response(
        JSON.stringify({
          error: transparentUnavailable
            ? 'Transparent preview is unavailable from the configured GPT Image 2.5 provider. No opaque fallback was returned.'
            : 'Failed to generate preview',
          code: transparentUnavailable ? 'transparent_provider_unavailable' : 'preview_generation_failed',
        }),
        { status: transparentUnavailable ? 503 : 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ image: result.image, contentBlocked: result.contentBlocked || previewBlocked || undefined }),
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
