import { getSupabaseAdmin } from './supabase/service'
import { Environment } from '@apple/app-store-server-library'
import { assertAppleIAPEnvironmentIsolation } from './billing/apple'

/** Welcome grants, intro offers and Apple Sandbox transactions do not unlock clean web downloads. */
export async function hasPaidMediaAccess(userId: string): Promise<boolean> {
  let appleEnvironments = 'Production'
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
