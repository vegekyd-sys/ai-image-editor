import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamTipsByCategory, ContentBlockedError, type UsageAccum } from '@/lib/gemini';
import { getSkill } from '@/lib/workspace';
import { requireCredits, deductByTokens, deductCredits } from '@/lib/billing/credits';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(session.user.id, 1);
    if (!creditCheck.ok) return creditCheck.response;

    const { image, category, metadata, count = 2, existingLabels, skillName } = await req.json();
    const locale = req.cookies.get('locale')?.value ?? 'zh';

    if (!image || !category) {
      return new Response(JSON.stringify({ error: 'image and category are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load skill context via workspace (built-in + user skills unified)
    let skillContext: string | undefined;
    if (skillName) {
      const skill = await getSkill(skillName, supabase, session.user.id);
      if (skill?.makaron?.tipsEnabled !== false && skill?.template) {
        skillContext = skill.template;
      }
    }

    const encoder = new TextEncoder();
    const usageAccum: UsageAccum = { inputTokens: 0, outputTokens: 0, model: '' };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const tip of streamTipsByCategory(image, category, metadata, count, existingLabels, locale, skillContext, usageAccum)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(tip)}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } catch (err) {
          if (err instanceof ContentBlockedError) {
            console.warn('[tips] Content blocked, sending [BLOCKED] to client');
            controller.enqueue(encoder.encode(`data: [BLOCKED]\n\n`));
          } else {
            console.error('Tips stream error:', err);
          }
        } finally {
          // Deduct credits: token-based if usage available, else per-action
          if (usageAccum.inputTokens > 0 && usageAccum.model) {
            deductByTokens(session.user.id, 'tips', usageAccum.model, usageAccum.inputTokens, usageAccum.outputTokens)
              .catch(e => console.error('[billing] tips deduct error:', e));
          } else {
            deductCredits(session.user.id, null, 'tips')
              .catch(e => console.error('[billing] tips deduct error:', e));
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Tips API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate tips' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
