import { getSupabaseAdmin } from './supabase/service'
import { Environment } from '@apple/app-store-server-library'
import { assertAppleIAPEnvironmentIsolation } from './billing/apple'

/** Sandbox access is opt-in on Preview only; production never treats it as a purchase. */
export async function hasPaidMediaAccess(userId: string): Promise<boolean> {
  let appleEnvironments = 'Production'
  if (process.env.MAKARON_PREVIEW_APPLE_MEDIA_ACCESS === '1') {
    if (process.env.VERCEL_ENV !== 'preview') throw new Error('Apple Sandbox media access requires Vercel Preview')
    appleEnvironments = 'Production,Sandbox'
  }
  if (process.env.MAKARON_E2E_APPLE_MEDIA_ACCESS === '1') {
    assertAppleIAPEnvironmentIsolation([Environment.XCODE, Environment.LOCAL_TESTING])
    appleEnvironments = 'Production,Xcode,LocalTesting'
  }
  const { data, error } = await getSupabaseAdmin().from('credit_purchases')
    .select('id').eq('user_id', userId).eq('status', 'completed').gt('amount_usd', 0)
    .in('source', ['topup', 'subscription', 'subscription_annual'])
    .or(appleEnvironments === 'Production'
      ? 'provider.eq.stripe,and(provider.eq.apple,apple_environment.eq.Production)'
      : `provider.eq.stripe,and(provider.eq.apple,apple_environment.in.(${appleEnvironments}))`).limit(1)
  if (error) throw new Error('Could not verify media entitlement')
  return Boolean(data?.length)
}
