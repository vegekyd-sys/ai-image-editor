import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { initializeSignupCredits } from '@/lib/billing/signup-credits'
import {
  APPLE_PENDING_CLAIM_COOKIE,
  claimPendingAppleTrial,
} from '@/lib/billing/apple-pending-claim'
import { userAgentHasMakaronIOSToken } from '@/lib/native-app'
import { appendAuthReturnParam, normalizeAuthReturnPath } from '@/lib/auth-return'
import {
  readAttributionCookie,
  recordFirstPartyMarketingEvent,
  sendMetaCapiEvent,
} from '@/lib/marketing/meta-capi'

type CompletionResult = {
  isNewUser: boolean
  credits: number
  trialRequired: boolean
  appleTrialClaimed: boolean
  redirectUrl: string
  metaEvents: { CompleteRegistration?: string }
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
  const isIOSApp = userAgentHasMakaronIOSToken(request.headers.get('user-agent') ?? undefined)
  let trialRequired = false
  let appleTrialClaimed = false
  if (!profile?.activated) {
    await admin.from('user_profiles').upsert({
      id: user.id,
      activated: true,
      invite_code_used: user.app_metadata?.provider === 'google' ? 'GOOGLE_OAUTH' : 'EMAIL_VERIFIED',
    }, { onConflict: 'id' })

    isNewUser = true
    trialRequired = isIOSApp
    try {
      const result = await initializeSignupCredits({
        admin,
        userId: user.id,
        isIOSApp,
      })
      credits = result.credits
      trialRequired = result.trialRequired
    } catch (completionError) {
      console.error('[auth/complete] Welcome credits failed (non-blocking):', completionError)
    }
  }

  const pendingAppleClaim = request.cookies.get(APPLE_PENDING_CLAIM_COOKIE)?.value
  if (isIOSApp && pendingAppleClaim) {
    try {
      const claimed = await claimPendingAppleTrial({
        claimToken: pendingAppleClaim,
        userId: user.id,
      })
      appleTrialClaimed = true
      trialRequired = false
      credits = claimed.result.balance.balance

      if (claimed.result.credited) {
        await recordFirstPartyMarketingEvent({
          eventName: 'Subscribe',
          eventId: `apple.subscription.${claimed.result.transactionId}`,
          eventSourceUrl: `${request.nextUrl.origin}/home`,
          userId: user.id,
          value: claimed.result.amountUsd,
          currency: 'USD',
          request,
          customData: {
            provider: 'apple',
            product_id: claimed.result.productId,
            transaction_id: claimed.result.transactionId,
            original_transaction_id: claimed.result.originalTransactionId,
            credits: claimed.result.credits,
            checkout_event_id: claimed.metaEventId,
            plan_id: claimed.result.planId,
            billing_interval: claimed.result.billingInterval,
            signup_order: 'subscription_before_registration',
            ...claimed.attribution,
          },
        })
      }
    } catch (claimError) {
      console.error('[auth/complete] Pending Apple trial claim failed (non-blocking):', claimError)
    }
  }

  const metaEvents: CompletionResult['metaEvents'] = isNewUser
    ? {
      CompleteRegistration: `registration.${user.id}`,
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
    } catch (trackingError) {
      console.error('[auth/complete] Registration tracking failed (non-blocking):', trackingError)
    }
  }

  return {
    isNewUser,
    credits,
    trialRequired,
    appleTrialClaimed,
    redirectUrl: appleTrialClaimed
      ? '/home?trial_ready=1'
      : isNewUser
        ? (trialRequired ? '/home?trial=1' : '/home?welcome=1')
        : '/projects',
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
  if (completion.appleTrialClaimed) {
    response.cookies.set(APPLE_PENDING_CLAIM_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
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
    trialRequired: completion.trialRequired,
    appleTrialClaimed: completion.appleTrialClaimed,
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
  const normalizedReturnPath = normalizeAuthReturnPath(requestedReturnPath)
  const destination = completion.isNewUser && normalizedReturnPath && !completion.appleTrialClaimed
    ? appendAuthReturnParam(normalizedReturnPath, completion.trialRequired ? 'trial' : 'welcome', '1')
    : normalizedReturnPath || completion.redirectUrl
  return applyCompletionCookies(
    NextResponse.redirect(new URL(destination, request.url)),
    completion,
  )
}
