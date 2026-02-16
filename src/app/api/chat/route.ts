import { NextRequest } from 'next/server';
import { chatStreamWithModel, resetSession } from '@/lib/gemini';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { sessionId, message, image, wantImage, aspectRatio, reset } = await req.json();

    if (!sessionId || !message) {
      return new Response(JSON.stringify({ error: 'sessionId and message are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (reset) {
      resetSession(sessionId);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of chatStreamWithModel(sessionId, message, image, wantImage, aspectRatio)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        } catch (err) {
          console.error('Chat stream error:', err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process chat request' })}\n\n`)
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
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process chat request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
