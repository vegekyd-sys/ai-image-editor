import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { isAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { invalidateBillingCache } from '@/lib/billing/credits'
import { getConfiguredWelcomeCredits } from '@/lib/billing/welcome-credits'
import { getConfiguredIOSTrialCredits } from '@/lib/billing/ios-trial'

async function checkAdmin(req: Request): Promise<string | null> {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return null
  const ok = await isAdmin(authResult.auth.userId)
  return ok ? authResult.auth.userId : null
}

// GET: billing settings
export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data: billing } = await admin.from('app_settings').select('value').eq('key', 'billing_enabled').single()
  return NextResponse.json({
    enabled: billing?.value === 'true',
    welcomeCredits: await getConfiguredWelcomeCredits(admin),
    iosTrialCredits: await getConfiguredIOSTrialCredits(admin),
  })
}

// PUT: update billing settings
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { enabled, welcomeCredits, iosTrialCredits } = await req.json()
  const admin = getSupabaseAdmin()
  if (enabled !== undefined) {
    await admin.from('app_settings').upsert({
      key: 'billing_enabled',
      value: enabled ? 'true' : 'false',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    invalidateBillingCache()
  }
  if (welcomeCredits !== undefined) {
    await admin.from('app_settings').upsert({
      key: 'welcome_credits',
      value: String(welcomeCredits),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  }
  if (iosTrialCredits !== undefined) {
    const parsedTrialCredits = Number(iosTrialCredits)
    if (!Number.isFinite(parsedTrialCredits) || parsedTrialCredits < 0) {
      return NextResponse.json({ error: 'Invalid iOS trial credits' }, { status: 400 })
    }
    const normalizedTrialCredits = Math.floor(parsedTrialCredits)
    await admin.from('app_settings').upsert({
      key: 'ios_trial_credits',
      value: String(normalizedTrialCredits),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    return NextResponse.json({ enabled, welcomeCredits, iosTrialCredits: normalizedTrialCredits })
  }
  return NextResponse.json({ enabled, welcomeCredits, iosTrialCredits })
}
