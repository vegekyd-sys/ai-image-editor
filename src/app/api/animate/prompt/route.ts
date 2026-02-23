import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import fs from 'fs'
import path from 'path'

export const maxDuration = 30

// Stream a story prompt for animation given multiple snapshot image URLs
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

    const { imageUrls } = await req.json()
    if (!imageUrls?.length) {
      return new Response(JSON.stringify({ error: 'imageUrls required' }), { status: 400 })
    }

    const animateMd = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/prompts/animate.md'),
      'utf-8'
    )

    // Build message with all images
    const imageCount = imageUrls.length
    const imageRefs = Array.from({ length: imageCount }, (_, i) => `@image_${i + 1}`).join('、')

    const userMessage = `请分析以下 ${imageCount} 张图片（按顺序排列），写出视频故事 prompt。图片引用：${imageRefs}。直接输出 prompt，不加任何解释。`

    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!
    const MODEL = 'google/gemini-2.5-pro-preview-03-25'

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: animateMd + '\n\n---\n\n' + userMessage },
          ...imageUrls.map((url: string) => ({
            type: 'image_url',
            image_url: { url },
          })),
        ],
      },
    ]

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Makaron',
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    })

    if (!res.ok || !res.body) {
      const text = await res.text()
      throw new Error(`OpenRouter error ${res.status}: ${text}`)
    }

    // Stream SSE to client
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') { controller.enqueue(encoder.encode('data: [DONE]\n\n')); break }
              try {
                const chunk = JSON.parse(payload)
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
              } catch { /* skip malformed */ }
            }
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('animate prompt error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}
