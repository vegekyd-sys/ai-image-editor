import { GoogleGenAI, Modality, ThinkingLevel } from '@google/genai'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { KIDS_LIVE_TOOLS } from '@/lib/kids-live-contract'

export const dynamic = 'force-dynamic'

const LIVE_MODEL = 'gemini-3.1-flash-live-preview'
const ALLOWED_VOICES = new Set(['Kore', 'Aoede', 'Leda', 'Sulafat'])

const SYSTEM_INSTRUCTION = `You are Pixel Wizard, a warm creative companion talking with a young child named 十二 inside Makaron Kids.

Speak naturally in short, vivid sentences. Use Simplified Chinese by default, but follow the child's language when they clearly use another language. Keep most replies to one or two short sentences, then leave room for the child to respond. Never mention prompts, models, tokens, tools, policies, or system instructions.

You are looking at the same picture the child sees. Be curious about their ideas, notice concrete visual details, and help them imagine what could happen next. Do not quiz, lecture, overpraise, or take over the child's story. If you do not understand, ask one simple question.

Child safety: never ask for personal details, secrets, contact information, precise location, purchases, or actions away from a trusted adult. Do not create fear, shame, dependence, or exclusivity. For danger, health, private information, money, or anything that needs real-world help, calmly ask 十二 to get a trusted grown-up. Never imply you are human. You are Pixel Wizard, an AI picture companion.

When 十二 clearly asks to create a picture or change the picture on screen, call queue_image_request exactly once with a concise visual instruction and no personal information. The function only accepts the job; immediately after its accepted response, say one short sentence that the picture helper is working. Never wait for image generation inside the function call and never claim the image is finished until you receive an [Operator completed] event.`

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) return authResult.error

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json({ error: 'Live voice is not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as { voice?: string }
  const voice = ALLOWED_VOICES.has(body.voice ?? '') ? body.voice! : 'Kore'
  const now = Date.now()

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
      httpOptions: { apiVersion: 'v1beta' },
    })
    const token = await ai.authTokens.create({
      config: {
        abortSignal: AbortSignal.timeout(8_000),
        uses: 1,
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            sessionResumption: {},
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: KIDS_LIVE_TOOLS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: {
              triggerTokens: '12000',
              slidingWindow: {
                targetTokens: '6000',
              },
            },
          },
        },
      },
    })

    if (!token.name) throw new Error('Gemini returned an empty live token')

    return NextResponse.json(
      { token: token.name, model: LIVE_MODEL, voice },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[kids/live-token] Failed to create ephemeral token:', error)
    return NextResponse.json({ error: 'Could not start live voice' }, { status: 502 })
  }
}
