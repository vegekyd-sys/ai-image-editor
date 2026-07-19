import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { chatStreamWithModel, resetSession } from '@/lib/gemini';
import { getRequestLocale } from '@/lib/server-locale';
import { translate } from '@/lib/locales';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const locale = getRequestLocale(req);
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
          for await (const event of chatStreamWithModel(sessionId, message, image, wantImage, aspectRatio, locale)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('Chat stream error:', errMsg);
          const userMsg = locale === 'en' ? translate(locale, 'agent.error.fatal') : errMsg;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: userMsg })}\n\n`)
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
