import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, CREDIT_TIERS, TierId } from '@/lib/billing/stripe'

function buildReturnUrl(origin: string, path: string | undefined, params: Record<string, string>) {
  const url = new URL(path || '/dashboard', origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tier, returnPath, metaEventId, attribution } = await req.json() as {
    tier: TierId
    returnPath?: string
    metaEventId?: string
    attribution?: Record<string, unknown>
  }
  const tierConfig = CREDIT_TIERS.find(t => t.id === tier)
  if (!tierConfig) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })

  const stripe = getStripe()
  const origin = req.headers.get('origin') || 'https://www.makaron.app'

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    metadata: {
      user_id: user.id,
      tier: tier,
      credits: String(tierConfig.credits),
      meta_event_id: metaEventId || '',
      attribution: JSON.stringify(attribution || {}).slice(0, 500),
      fbp: req.cookies.get('_fbp')?.value || '',
      fbc: req.cookies.get('_fbc')?.value || '',
    },
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: tierConfig.price,
        product_data: {
          name: `Makaron Credits — ${tierConfig.name}`,
          description: `${tierConfig.credits} credits for Makaron MCP API`,
        },
      },
      quantity: 1,
    }],
    success_url: buildReturnUrl(origin, returnPath, {
      topped_up: '1',
      checkout_type: 'topup',
      ...(metaEventId ? { meta_event_id: metaEventId } : {}),
    }),
    cancel_url: buildReturnUrl(origin, returnPath, {}),
  })

  return NextResponse.json({ url: session.url })
}
