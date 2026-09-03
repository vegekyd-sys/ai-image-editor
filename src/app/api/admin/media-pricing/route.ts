import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getMediaPrices } from '@/lib/billing/media-pricing'

const updateSchema = z.object({
  id: z.string().min(1), updated_at: z.string().min(1),
  output_usd_per_second: z.number().finite().positive().max(10000),
  input_usd_per_second: z.number().finite().nonnegative().max(10000),
  input_usd_per_image: z.number().finite().nonnegative().max(10000),
  free_image_references: z.number().int().nonnegative().max(100),
  markup: z.number().finite().positive().max(100),
  unfiltered_multiplier: z.number().finite().min(1).max(100),
  is_active: z.boolean(),
}).strict()

async function allowed(req: Request) {
  const auth = await authenticateRequest(req)
  return !('error' in auth) && await isAdmin(auth.auth.userId)
}

export async function GET(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json(await getMediaPrices(), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'pricing_unavailable' }, { status: 503 })
  }
}

export async function PUT(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
  const { id, updated_at, ...values } = parsed.data
  const result = await getSupabaseAdmin().from('media_pricing')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).eq('updated_at', updated_at).select('*').maybeSingle()
  if (result.error) return NextResponse.json({ error: 'pricing_unavailable' }, { status: 503 })
  if (!result.data) return NextResponse.json({ error: 'price_conflict' }, { status: 409 })
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } })
}
