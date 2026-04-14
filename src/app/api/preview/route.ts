import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/model-router';
import { requireCredits, deductByTokens, deductCredits } from '@/lib/billing/credits';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(user.id, 2);
    if (!creditCheck.ok) return creditCheck.response;

    const { image, editPrompt, aspectRatio, category, isNsfw, referenceImages } = await req.json();

    if (!image || !editPrompt) {
      return new Response(
        JSON.stringify({ error: 'image and editPrompt are required' }),
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

    // Skill reference images → model-router references format
    const references = referenceImages?.length
      ? (referenceImages as string[]).map((url: string) => ({ url, role: 'Skill reference — use for visual identity' }))
      : undefined;

    const result = await generateImage({ image, prompt: editPrompt, aspectRatio, category, isNsfw, references });

    if (!result.image) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate preview' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Deduct credits (fire-and-forget)
    if (result.usage) {
      // Token-based billing (Gemini/OpenRouter with usage data)
      deductByTokens(user.id, 'preview', result.usage.modelId, result.usage.inputTokens, result.usage.outputTokens)
        .catch(e => console.error('[billing] preview deduct error:', e));
    } else {
      // Per-action fallback (ComfyUI or Gemini without usage)
      const toolName = result.model === 'gemini' ? 'preview' : `edit_image_${result.model}`;
      deductCredits(user.id, null, toolName)
        .catch(e => console.error('[billing] preview deduct error:', e));
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
