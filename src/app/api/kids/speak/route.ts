import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { synthesizeWithVolcengineTts } from '@/lib/volcengine-tts'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) return authResult.error

  const body = await request.json().catch(() => ({})) as { text?: string }
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (!text) return NextResponse.json({ error: 'Speech text is required' }, { status: 400 })

  try {
    const speech = await synthesizeWithVolcengineTts({
      text,
      format: 'mp3',
      sampleRate: 24_000,
      speechRate: -8,
      timeoutMs: 60_000,
    })
    return new Response(Buffer.from(speech.audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, no-store',
        'X-Kids-Voice-Provider': speech.provider,
      },
    })
  } catch (error) {
    console.error('[kids/speak] Failed:', error)
    return NextResponse.json({ error: 'Could not make the voice reply' }, { status: 502 })
  }
}
