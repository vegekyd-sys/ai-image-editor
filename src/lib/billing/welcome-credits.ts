import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_WELCOME_CREDITS = 500

export function resolveWelcomeCredits(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_WELCOME_CREDITS
  if (typeof value === 'string' && !value.trim()) return DEFAULT_WELCOME_CREDITS
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WELCOME_CREDITS
  return Math.floor(parsed)
}

export async function getConfiguredWelcomeCredits(
  admin: Pick<SupabaseClient, 'from'>,
): Promise<number> {
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'welcome_credits')
    .single()
  return resolveWelcomeCredits(data?.value)
}
