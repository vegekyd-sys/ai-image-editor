import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getConfiguredAppleProducts } from '@/lib/billing/apple'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getConfiguredIOSTrialCredits } from '@/lib/billing/ios-trial'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const trialCredits = await getConfiguredIOSTrialCredits(getSupabaseAdmin())
  return NextResponse.json({
    // Before registration StoreKit intentionally receives no account token.
    // The verified transaction is held server-side and linked after auth.
    appAccountToken: user?.id,
    products: getConfiguredAppleProducts(trialCredits),
  })
}
