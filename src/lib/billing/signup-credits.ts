import type { SupabaseClient } from '@supabase/supabase-js'
import { getConfiguredWelcomeCredits } from './welcome-credits'
import { FREE_MEDIA_ENABLED } from '../free-media-policy'

type AdminClient = Pick<SupabaseClient, 'from' | 'rpc'>

export interface SignupCreditResult {
  credits: number
  trialRequired: boolean
}

/**
 * One atomic welcome grant per account, shared by native iOS and web.
 */
export async function initializeSignupCredits(args: {
  admin: AdminClient
  userId: string
  isIOSApp: boolean
}): Promise<SignupCreditResult> {
  if (args.isIOSApp && !FREE_MEDIA_ENABLED) {
    const { error } = await args.admin.from('credit_balances').upsert({
      user_id: args.userId, balance: 0, lifetime_purchased: 0, lifetime_used: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id', ignoreDuplicates: true })
    if (error) throw new Error(`Could not initialize iOS trial balance: ${error.message}`)
    return { credits: 0, trialRequired: true }
  }
  const credits = await getConfiguredWelcomeCredits(args.admin)
  if (credits <= 0) return { credits: 0, trialRequired: false }

  const { data, error } = await args.admin.rpc('claim_welcome_credits', {
    p_user_id: args.userId,
    p_credits: credits,
    p_channel: args.isIOSApp ? 'ios_signup' : 'web_signup',
  })
  if (error) throw new Error(`Could not claim welcome credits: ${error.message}`)

  return {
    credits: data?.granted === true ? Number(data?.credits ?? credits) : 0,
    trialRequired: false,
  }
}
