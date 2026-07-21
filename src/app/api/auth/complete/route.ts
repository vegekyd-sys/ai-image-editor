import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getConfiguredWelcomeCredits } from '@/lib/billing/welcome-credits'
import { resolveAuthCompletionDestination } from '@/lib/auth-return'
import { readAttributionCookie, sendMetaCapiEvent } from '@/lib/marketing/meta-capi'

type CompletionResult = {
  isNewUser: boolean
  credits: number
  redirectUrl: string
  metaEvents: { CompleteRegistration?: string; StartTrial?: string }
  cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]
}

async function completeVerifiedSession(request: NextRequest): Promise<CompletionResult | null> {
  const cookieStore = await cookies()
  const cookiesToSet: CompletionResult['cookiesToSet'] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(updatedCookies) {
          updatedCookies.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
            cookiesToSet.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    },
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  const verified = Boolean(user?.email_confirmed_at || user?.phone_confirmed_at)
  if (error || !user || !verified) return null

  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('activated')
    .eq('id', user.id)
    .single()

  let isNewUser = false
  let credits = 0
  if (!profile?.activated) {
    await admin.from('user_profiles').upsert({
      id: user.id,
      activated: true,
      invite_code_used: user.app_metadata?.provider === 'google' ? 'GOOGLE_OAUTH' : 'EMAIL_VERIFIED',
    }, { onConflict: 'id' })

    try {
      const { data: existingBalance } = await admin
        .from('credit_balances')
        .select('balance')
        .eq('user_id', user.id)
        .single()

      if (!existingBalance) {
        isNewUser = true
        credits = await getConfiguredWelcomeCredits(admin)

        if (credits > 0) {
          const { addCredits } = await import('@/lib/billing/credits')
          await addCredits(user.id, credits)

          await admin.from('credit_purchases').insert({
            user_id: user.id,
            stripe_session_id: `welcome_gift_${user.app_metadata?.provider || 'email'}`,
            credits,
            amount_usd: 0,
            status: 'completed',
            source: 'welcome',
          })
        }
      }
    } catch (completionError) {
      console.error('[auth/complete] Welcome credits failed (non-blocking):', completionError)
    }
  }

  const metaEvents: CompletionResult['metaEvents'] = isNewUser
    ? {
      CompleteRegistration: `registration.${user.id}`,
      ...(credits > 0 ? { StartTrial: `starttrial.${user.id}` } : {}),
    }
    : {}

  if (isNewUser) {
    const attribution = readAttributionCookie(request.cookies.get('mkr_attribution')?.value)
    let eventSourceUrl = `${request.nextUrl.origin}/home`
    if (typeof attribution.landing_path === 'string') {
      try {
        eventSourceUrl = new URL(attribution.landing_path, request.nextUrl.origin).toString()
      } catch {}
    }
    try {
      await sendMetaCapiEvent({
        eventName: 'CompleteRegistration',
        eventId: metaEvents.CompleteRegistration!,
        userId: user.id,
        email: user.email,
        request,
        eventSourceUrl,
        customData: attribution,
      })
      if (credits > 0) {
        await sendMetaCapiEvent({
          eventName: 'StartTrial',
          eventId: metaEvents.StartTrial!,
          userId: user.id,
          email: user.email,
          request,
          eventSourceUrl,
          customData: { credits, ...attribution },
        })
      }
    } catch (trackingError) {
      console.error('[auth/complete] Registration tracking failed (non-blocking):', trackingError)
    }
  }

  return {
    isNewUser,
    credits,
    redirectUrl: isNewUser ? '/home?welcome=1' : '/projects',
    metaEvents,
    cookiesToSet,
  }
}

function applyCompletionCookies(response: NextResponse, completion: CompletionResult) {
  completion.cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })
  return response
}

export async function POST(request: NextRequest) {
  const completion = await completeVerifiedSession(request)
  if (!completion) {
    return NextResponse.json({ error: 'Verified authentication required' }, { status: 401 })
  }

  return applyCompletionCookies(NextResponse.json({
    ok: true,
    isNewUser: completion.isNewUser,
    credits: completion.credits,
    redirectUrl: completion.redirectUrl,
    metaEvents: completion.metaEvents,
  }), completion)
}

export async function GET(request: NextRequest) {
  const completion = await completeVerifiedSession(request)
  if (!completion) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const requestedReturnPath = request.nextUrl.searchParams.get('next')
  const destination = resolveAuthCompletionDestination(requestedReturnPath, completion.isNewUser)
  return applyCompletionCookies(
    NextResponse.redirect(new URL(destination, request.url)),
    completion,
  )
}
