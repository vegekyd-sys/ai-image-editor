import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConfiguredAppleProducts } from '@/lib/billing/apple'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getConfiguredIOSTrialCredits } from '@/lib/billing/ios-trial'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trialCredits = await getConfiguredIOSTrialCredits(getSupabaseAdmin())
  return NextResponse.json({
    appAccountToken: user.id,
    products: getConfiguredAppleProducts(trialCredits),
  })
}
