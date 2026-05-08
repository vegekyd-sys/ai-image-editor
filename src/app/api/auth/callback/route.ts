import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const cookieStore = await cookies()

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
          })
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
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
    const response = NextResponse.redirect(`${origin}/projects`)
    response.cookies.set('mkr_activated', '1', {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      sameSite: 'lax',
    })
    return response
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
      const { data: setting } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'welcome_credits')
        .single()
      const welcomeCredits = parseInt(setting?.value || '500')

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

  const redirectUrl = isNewUser ? `${origin}/home?welcome=1` : `${origin}/projects`
  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })
  return response
}
