import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe, CREDIT_TIERS, TierId } from '@/lib/billing/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tier } = await req.json() as { tier: TierId }
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
    success_url: `${origin}/dashboard?payment=success`,
    cancel_url: `${origin}/dashboard?payment=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}
