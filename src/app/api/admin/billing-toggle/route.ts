import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { invalidateBillingCache } from '@/lib/billing/credits'

const ADMIN_EMAILS = ['vege_kyd@msn.com']

async function checkAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) return null
  return user
}

// GET: billing settings
export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data: billing } = await admin.from('app_settings').select('value').eq('key', 'billing_enabled').single()
  const { data: welcome } = await admin.from('app_settings').select('value').eq('key', 'welcome_credits').single()
  return NextResponse.json({
    enabled: billing?.value === 'true',
    welcomeCredits: parseInt(welcome?.value || '500'),
  })
}

// PUT: update billing settings
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { enabled, welcomeCredits } = await req.json()
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
  return NextResponse.json({ enabled, welcomeCredits })
}
