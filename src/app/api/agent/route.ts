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

    const { prompt, image, projectId, analysisOnly, analysisContext } = await req.json();

    if (!image || !projectId) {
      return new Response(
        JSON.stringify({ error: 'image and projectId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
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
