import { NextRequest } from 'next/server';
import { streamTips } from '@/lib/gemini';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json();

    if (!image) {
      return new Response(JSON.stringify({ error: 'image is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const tip of streamTips(image)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(tip)}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } catch (err) {
          console.error('Tips stream error:', err);
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
    console.error('Tips API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate tips' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
