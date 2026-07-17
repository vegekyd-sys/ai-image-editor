import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function POST(_request: NextRequest) {
  const cookieStore = await cookies()
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

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('activated')
    .eq('id', user.id)
    .single()

  let isNewUser = false
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
      console.error('[auth/native-complete] Welcome credits failed (non-blocking):', e)
    }
  }

  const response = NextResponse.json({
    ok: true,
    isNewUser,
    redirectUrl: isNewUser ? '/home?welcome=1' : '/projects',
  })

  cookiesToSetOnResponse.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })
  response.cookies.set('mkr_activated', '1', {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  })

  return response
}
