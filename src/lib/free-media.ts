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
  const providerFilter = appleEnvironments === 'Production'
    ? 'provider.eq.stripe,and(provider.eq.apple,apple_environment.eq.Production)'
    : `provider.eq.stripe,and(provider.eq.apple,apple_environment.in.(${appleEnvironments}))`
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('credit_purchases')
    .select('id').eq('user_id', userId).eq('status', 'completed').gt('amount_usd', 0)
    .in('source', ['topup', 'subscription', 'subscription_annual'])
    .or(providerFilter).limit(1)
  if (error) throw new Error('Could not verify media entitlement')
  if (data?.length) return true

  // A verified subscription trial includes clean exports only while it is valid.
  // Welcome credits and historical zero-dollar purchase rows are not membership.
  const now = new Date().toISOString()
  const { data: trials, error: trialError } = await admin.from('subscriptions')
    .select('id').eq('user_id', userId).eq('status', 'trialing')
    .in('plan_id', ['basic', 'pro', 'business'])
    .lte('current_period_start', now).gt('current_period_end', now)
    .or(providerFilter).limit(1)
  if (trialError) throw new Error('Could not verify trial media entitlement')
  return Boolean(trials?.length)
}
