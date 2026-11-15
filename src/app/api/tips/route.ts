import { after, NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamTipsByCategory, ContentBlockedError, type UsageAccum } from '@/lib/gemini';
import { getSkill } from '@/lib/workspace';
import { requireCredits, deductByTokens, deductCredits } from '@/lib/billing/credits';
import { getRequestLocale } from '@/lib/server-locale';

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
    const locale = getRequestLocale(req);

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
    let finishStream!: () => void;
    const streamFinished = new Promise<void>(resolve => { finishStream = resolve; });
    let billingWork: Promise<unknown> | undefined;
    // Register while the request context is active. Keep settlement alive even
    // after the response closes, without making the UI wait for a billing read.
    after(async () => { await streamFinished; await billingWork; });
    let cancelled = false;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const tip of streamTipsByCategory(image, category, metadata, count, existingLabels, locale, skillContext, usageAccum)) {
            if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(tip)}\n\n`));
          }
          if (!cancelled) controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } catch (err) {
          if (err instanceof ContentBlockedError) {
            console.warn('[tips] Content blocked, sending [BLOCKED] to client');
            if (!cancelled) controller.enqueue(encoder.encode(`data: [BLOCKED]\n\n`));
          } else {
            console.error('Tips stream error:', err);
          }
        } finally {
          // Deduct credits: token-based if usage available, else per-action
          if (usageAccum.inputTokens > 0 && usageAccum.model) {
            billingWork = deductByTokens(session.user.id, 'tips', usageAccum.model, usageAccum.inputTokens, usageAccum.outputTokens)
              .catch(e => console.error('[billing] tips deduct error:', e));
          } else {
            billingWork = deductCredits(session.user.id, null, 'tips')
              .catch(e => console.error('[billing] tips deduct error:', e));
          }
          try { if (!cancelled) controller.close(); } finally { finishStream(); }
        }
      },
      cancel() { cancelled = true; },
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
