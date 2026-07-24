import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { readAttributionCookie, sendMetaCapiEvent } from '@/lib/marketing/meta-capi'
import { getConfiguredWelcomeCredits } from '@/lib/billing/welcome-credits'

/**
 * POST /api/auth/activate
 * Authenticated. Activates user + grants welcome credits if first time.
 * Called by home page on ?welcome=1 after new user registration.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()

  const { data: profile } = await admin
    .from('user_profiles')
    .select('activated')
    .eq('id', user.id)
    .single()

  if (profile?.activated) {
    return NextResponse.json({ activated: true, isNew: false })
  }

  await admin.from('user_profiles').upsert({
    id: user.id,
    activated: true,
    invite_code_used: user.app_metadata?.provider === 'google' ? 'GOOGLE_OAUTH' : 'EMAIL_OTP',
  }, { onConflict: 'id' })

  let credits = 0
  const { data: existingBalance } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .single()

  if (!existingBalance) {
    credits = await getConfiguredWelcomeCredits(admin)

    if (credits > 0) {
      const { addCredits } = await import('@/lib/billing/credits')
      await addCredits(user.id, credits)
      await admin.from('credit_purchases').insert({
        user_id: user.id,
        stripe_session_id: 'welcome_gift',
        credits,
        amount_usd: 0,
        status: 'completed',
        source: 'welcome',
      })
    }
  }

  const registrationEventId = `registration.${user.id}`
  const response = NextResponse.json({
    activated: true,
    isNew: true,
    credits,
    metaEvents: {
      CompleteRegistration: registrationEventId,
    },
  })
  const attribution = readAttributionCookie(req.cookies.get('mkr_attribution')?.value)
  let eventSourceUrl = `${req.nextUrl.origin}/home`
  if (typeof attribution.landing_path === 'string') {
    try {
      eventSourceUrl = new URL(attribution.landing_path, req.nextUrl.origin).toString()
    } catch {}
  }
  await sendMetaCapiEvent({
    eventName: 'CompleteRegistration',
    eventId: registrationEventId,
    userId: user.id,
    email: user.email,
    request: req,
    eventSourceUrl,
    customData: attribution,
  })
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })
  return response
}
