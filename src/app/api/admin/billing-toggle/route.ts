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

// GET: check billing status
export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = getSupabaseAdmin()
  const { data } = await admin.from('app_settings').select('value').eq('key', 'billing_enabled').single()
  return NextResponse.json({ enabled: data?.value === 'true' })
}

// PUT: toggle billing
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { enabled } = await req.json()
  const admin = getSupabaseAdmin()
  await admin.from('app_settings').upsert({
    key: 'billing_enabled',
    value: enabled ? 'true' : 'false',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  invalidateBillingCache()
  return NextResponse.json({ enabled })
}
