import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runMakaronAgent, withLocale } from '@/lib/agent';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { prompt, image, originalImage, referenceImages, animationImageUrls, animationImages, projectId, analysisOnly, analysisContext,
            tipReaction, committedTip, currentTips, tipsTeaser, tipsPayload, nameProject, description,
            previewsReady, readyTips, preferredModel, snapshotImages, currentSnapshotIndex, isNsfw } = await req.json();
    const locale = req.cookies.get('locale')?.value ?? 'zh';

    if (!projectId || (!tipsTeaser && !nameProject && !previewsReady && !image && !prompt)) {
      return new Response(
        JSON.stringify({ error: 'projectId and (image or prompt) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const MOCK_TEXTS = {
      tipsTeaser: '试试把它变成微缩模型？特别适合这种场景。',
      tipReaction: '效果很棒！新图很自然。',
      nameProject: '咖啡下午茶',
      previewsReady: '预览图都好了！那个模仿猴的创意太逗了，快去试试看~',
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // tipsTeaser: generate a one-sentence teaser about the tips (no image needed)
          if (tipsTeaser && tipsPayload) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.tipsTeaser })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tipsSummary = (tipsPayload as { category: string; emoji: string; label: string; desc: string }[])
              .map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`)
              .join('\n');
            const teaserPrompt = withLocale(
              `Here are edit suggestions for a photo:\n${tipsSummary}\n\nPick the most interesting one. Write a single teaser sentence (under 15 words) starting with "Try...". Output only that sentence.`,
              locale,
            );
            for await (const event of runMakaronAgent(teaserPrompt, '', projectId, { tipReactionOnly: true, locale })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            return;
          }

          // nameProject: generate a short project name from image description
          if (nameProject) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.nameProject })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const desc = (description as string) || '';
            const namePrompt = withLocale(
              `Based on this photo description, give a concise project name (2-4 words): ${desc}. Output only the name, no punctuation or explanation.`,
              locale,
            );
            for await (const event of runMakaronAgent(namePrompt, '', projectId, { tipReactionOnly: true, locale })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            return;
          }

          // previewsReady: AI notification that all preview images are done
          if (previewsReady && readyTips) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.previewsReady })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tips = readyTips as { emoji: string; label: string; desc: string; category: string }[];
            const tipsSummary = tips
              .map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`)
              .join('\n');
            const readyPrompt = withLocale(
              `All ${tips.length} edit suggestion previews are ready:\n${tipsSummary}\n\nIn 1-2 sentences, tell the user previews are ready and they can scroll TipsBar. Comment on one interesting one. Friendly tone, don't start with "I".`,
              locale,
            );
            for await (const event of runMakaronAgent(readyPrompt, '', projectId, { tipReactionOnly: true, locale })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            return;
          }

          // tipReaction: react to a committed tip in CUI (1-2 sentences)
          if (tipReaction && committedTip) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.tipReaction })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tip = committedTip as { emoji: string; label: string; desc: string; category: string };
            const reactionPrompt = withLocale(
              `User just committed an edit via TipsBar:\n${tip.emoji} ${tip.label} (${tip.category}): ${tip.desc}\n\nReact naturally in 1 sentence, like a friend. Then in 1 short sentence, inspire what direction they could explore next with this photo (e.g. mood, lighting, story element) — but do NOT recommend specific tips. Don't start with "I".`,
              locale,
            );
            for await (const event of runMakaronAgent(reactionPrompt, image, projectId, { tipReactionOnly: true, locale })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            return;
          }

          // Load user skills from workspace
          const { getAllSkills } = await import('@/lib/workspace');
          const allSkills = await getAllSkills(supabase, user.id);
          const userSkills = allSkills.filter(s => !s.makaron?.builtIn);

          // Normal agent request — SSE heartbeat every 10s to prevent proxy idle timeout
          const heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }, 10_000);
          try {
            for await (const event of runMakaronAgent(prompt ?? '', image, projectId, { analysisOnly, analysisContext, originalImage, referenceImages: referenceImages?.length ? referenceImages : undefined, animationImageUrls: animationImageUrls?.length ? animationImageUrls : undefined, animationImages: animationImages?.length ? animationImages : undefined, locale, preferredModel, snapshotImages: snapshotImages?.length ? snapshotImages : undefined, currentSnapshotIndex, isNsfw, userSkills: userSkills.length ? userSkills : undefined, supabase, userId: user.id })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } finally {
            clearInterval(heartbeat);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Agent stream error:', msg);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Agent API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process agent request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
