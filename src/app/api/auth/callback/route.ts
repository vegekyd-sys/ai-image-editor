import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { readAttributionCookie, sendMetaCapiEvent } from '@/lib/marketing/meta-capi'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { getConfiguredWelcomeCredits } from '@/lib/billing/welcome-credits'
import { appendAuthReturnParam, normalizeAuthReturnPath } from '@/lib/auth-return'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = getPublicOrigin(request)
  const code = searchParams.get('code')
  const requestedReturnPath = normalizeAuthReturnPath(searchParams.get('next'))

  if (searchParams.get('native_oauth') === '1') {
    return buildNativeOAuthCallbackPage(request)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const cookieStore = await cookies()

  // Collect cookies that need to be set on the response
  const cookiesToSetOnResponse: { name: string; value: string; options: Record<string, unknown> }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
            cookiesToSetOnResponse.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    return NextResponse.redirect(`${origin}/login`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  // Check if user is already activated
  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('activated')
    .eq('id', user.id)
    .single()

  if (profile?.activated) {
    const redirectUrl = requestedReturnPath ? new URL(requestedReturnPath, origin).toString() : `${origin}/projects`
    return buildRedirectPage(redirectUrl, cookiesToSetOnResponse)
  }

  // Auto-activate: all users who reach callback are verified
  await admin.from('user_profiles').upsert({
    id: user.id,
    activated: true,
    invite_code_used: user.app_metadata?.provider === 'google' ? 'GOOGLE_OAUTH' : 'EMAIL_VERIFIED',
  }, { onConflict: 'id' })

  // Grant welcome credits (only if user has no balance yet)
  let isNewUser = false
  try {
    const { data: existingBalance } = await admin
      .from('credit_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single()

    if (!existingBalance) {
      isNewUser = true
      const welcomeCredits = await getConfiguredWelcomeCredits(admin)

      if (welcomeCredits > 0) {
        const { addCredits } = await import('@/lib/billing/credits')
        await addCredits(user.id, welcomeCredits)

        await admin.from('credit_purchases').insert({
          user_id: user.id,
          stripe_session_id: `welcome_gift_${user.app_metadata?.provider || 'email'}`,
          credits: welcomeCredits,
          amount_usd: 0,
          status: 'completed',
          source: 'welcome',
        })
      }
    }
  } catch (e) {
    console.error('[auth/callback] Welcome credits failed (non-blocking):', e)
  }

  const requestedDestination = requestedReturnPath
    ? (isNewUser ? appendAuthReturnParam(requestedReturnPath, 'welcome', '1') : requestedReturnPath)
    : ''
  const redirectUrl = requestedDestination
    ? new URL(requestedDestination, origin).toString()
    : (isNewUser ? `${origin}/home?welcome=1` : `${origin}/projects`)
  if (isNewUser) {
    const attribution = readAttributionCookie(request.cookies.get('mkr_attribution')?.value)
    let eventSourceUrl = `${origin}/home`
    if (typeof attribution.landing_path === 'string') {
      try {
        eventSourceUrl = new URL(attribution.landing_path, origin).toString()
      } catch {}
    }
    await sendMetaCapiEvent({
      eventName: 'CompleteRegistration',
      eventId: `registration.${user.id}`,
      userId: user.id,
      email: user.email,
      request,
      eventSourceUrl,
      customData: attribution,
    })
  }
  return buildRedirectPage(redirectUrl, cookiesToSetOnResponse)
}

function buildNativeOAuthCallbackPage(request: NextRequest) {
  const callbackUrl = new URL('app.makaron.ios://auth/callback')
  request.nextUrl.searchParams.forEach((value, key) => {
    callbackUrl.searchParams.append(key, value)
  })
  const target = callbackUrl.toString()

  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Returning to Makaron...</title></head><body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,sans-serif"><script>window.location.replace(${JSON.stringify(target)});</script><a style="color:#d946ef" href=${JSON.stringify(target)}>Return to Makaron</a></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  )
}

/**
 * Return an HTML page that sets cookies in first-party context then redirects.
 * iOS Safari ITP blocks cookies set during cross-origin redirects (OAuth flow),
 * but allows them when set by a same-origin page via document.cookie or response headers.
 */
function buildRedirectPage(
  redirectUrl: string,
  authCookies: { name: string; value: string; options: Record<string, unknown> }[],
) {
  // The HTML page reads sessionStorage for returnUrl (saved by home page before login redirect)
  // and uses it if available, otherwise falls back to the server-determined redirectUrl.
  const serializedRedirectUrl = JSON.stringify(redirectUrl)
  const response = new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Redirecting...</title></head><body style="background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><script>
var r=sessionStorage.getItem('mkr_return_url')||localStorage.getItem('mkr_return_url');
sessionStorage.removeItem('mkr_return_url');
localStorage.removeItem('mkr_return_url');
var skillMatch=r&&r.match(/^\\/home\\/([^/?]+)/);
if(skillMatch){
  if((navigator.userAgent||'').indexOf('MakaronIOS')!==-1){
    sessionStorage.setItem('makaron:ios-pending-home-skill-id',skillMatch[1]);
    localStorage.setItem('makaron:ios-pending-home-skill-id',skillMatch[1]);
    r='/home';
  }else{
    r='/home?skill='+encodeURIComponent(skillMatch[1]);
  }
}
var fallback=${serializedRedirectUrl};
var welcome=fallback.includes('welcome=1');
if(r){var sep=r.includes('?')?'&':'?';window.location.href=r+(welcome?sep+'welcome=1':'');}
else{window.location.href=fallback;}
</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  )
  // Set auth cookies on this first-party response
  authCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })
  return response
}
