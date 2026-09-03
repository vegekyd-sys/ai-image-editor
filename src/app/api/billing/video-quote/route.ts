import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/api-auth'
import { quoteVideo } from '@/lib/billing/media-pricing'

export async function POST(req: Request) {
  const auth = await authenticateRequest(req)
  if ('error' in auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = z.object({
    model: z.string(), resolution: z.enum(['auto','360p','480p','720p','768p','1080p','2k','4k']),
    durationSec: z.number().positive().max(120), imageCount: z.number().int().nonnegative().max(100),
  }).strict().safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_quote' }, { status: 400 })
  try {
    const quote = await quoteVideo(parsed.data)
    return NextResponse.json({ credits: quote.credits, priceVersion: quote.priceVersion }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'pricing_unavailable' }, { status: 503 })
  }
}
