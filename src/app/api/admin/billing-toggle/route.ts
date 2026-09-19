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
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid billing toggle' }, { status: 400 })
  }
  let normalizedTrialCredits: number | undefined
  if (iosTrialCredits !== undefined) {
    const parsedTrialCredits = Number(iosTrialCredits)
    if (!Number.isFinite(parsedTrialCredits) || parsedTrialCredits < 0) {
      return NextResponse.json({ error: 'Invalid iOS trial credits' }, { status: 400 })
    }
    normalizedTrialCredits = Math.floor(parsedTrialCredits)
  }
  if (welcomeCredits !== undefined && (!Number.isFinite(Number(welcomeCredits)) || Number(welcomeCredits) < 0)) {
    return NextResponse.json({ error: 'Invalid welcome credits' }, { status: 400 })
  }

  const updated_at = new Date().toISOString()
  const settings = []
  if (enabled !== undefined) settings.push({ key: 'billing_enabled', value: String(enabled), updated_at })
  if (welcomeCredits !== undefined) settings.push({ key: 'welcome_credits', value: String(welcomeCredits), updated_at })
  if (normalizedTrialCredits !== undefined) settings.push({ key: 'ios_trial_credits', value: String(normalizedTrialCredits), updated_at })
  if (settings.length) {
    // One statement keeps a multi-setting change atomic. Never report success
    // or invalidate the cache if the database rejected the write.
    const { error } = await getSupabaseAdmin().from('app_settings').upsert(settings, { onConflict: 'key' })
    if (error) {
      return NextResponse.json({ error: 'Unable to save billing settings' }, { status: 503 })
    }
    if (enabled !== undefined) invalidateBillingCache()
  }
  return NextResponse.json({ enabled, welcomeCredits, iosTrialCredits: normalizedTrialCredits })
}
