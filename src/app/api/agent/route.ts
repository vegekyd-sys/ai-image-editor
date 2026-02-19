import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runMakaronAgent } from '@/lib/agent';

export const maxDuration = 120;

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

    const { prompt, image, projectId, analysisOnly, analysisContext,
            tipReaction, committedTip, tipsTeaser, tipsPayload, nameProject, description } = await req.json();

    if (!projectId || (!tipsTeaser && !nameProject && !image)) {
      return new Response(
        JSON.stringify({ error: 'projectId and image (or tipsTeaser) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const MOCK_TEXTS = {
      tipsTeaser: '试试把它变成微缩模型？特别适合这种场景。',
      tipReaction: '效果很棒！新图很自然。',
      nameProject: '咖啡下午茶',
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
            const teaserPrompt = `以下是为一张照片生成的6条编辑建议：\n${tipsSummary}\n\n选出最有趣的1条，用一句话（15字以内）勾起用户好奇心，用"试试..."开头。只输出这句话。`;
            for await (const event of runMakaronAgent(teaserPrompt, '', projectId, { tipReactionOnly: true })) {
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
            const namePrompt = `根据以下照片描述，用2-4个中文词起一个简洁的项目名（如"咖啡下午茶"、"都市街头"、"猫咪日常"）：${desc}。只输出名称，不加任何标点或解释。`;
            for await (const event of runMakaronAgent(namePrompt, '', projectId, { tipReactionOnly: true })) {
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
            const reactionPrompt = `用户刚刚通过TipsBar确认了编辑操作：\n${tip.emoji} ${tip.label}（${tip.category}）：${tip.desc}\n\n用1-2句中文自然地回应，像朋友聊天。可评价效果或提下一步。禁止以"我"开头，禁止照抄tip名称。`;
            for await (const event of runMakaronAgent(reactionPrompt, image, projectId, { tipReactionOnly: true })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            return;
          }

          // Normal agent request
          for await (const event of runMakaronAgent(prompt ?? '', image, projectId, { analysisOnly, analysisContext })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
