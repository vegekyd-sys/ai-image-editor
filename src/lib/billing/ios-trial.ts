import type { SupabaseClient } from '@supabase/supabase-js'

export const IOS_TRIAL_DAYS = 3
export const DEFAULT_IOS_TRIAL_CREDITS = 1500

export function resolveIOSTrialCredits(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_IOS_TRIAL_CREDITS
  if (typeof value === 'string' && !value.trim()) return DEFAULT_IOS_TRIAL_CREDITS
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IOS_TRIAL_CREDITS
  return Math.floor(parsed)
}

export async function getConfiguredIOSTrialCredits(
  admin: Pick<SupabaseClient, 'from'>,
): Promise<number> {
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'ios_trial_credits')
    .single()
  return resolveIOSTrialCredits(data?.value)
}
