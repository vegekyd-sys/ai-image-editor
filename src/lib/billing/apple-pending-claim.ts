import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import {
  applyAppleTransaction,
  requireAppleBasicIntroTrial,
  verifyAppleTransaction,
  type AppleApplyResult,
} from './apple'
import { IOS_TRIAL_DAYS } from './ios-trial'

export const APPLE_PENDING_CLAIM_COOKIE = 'mkr_apple_trial_claim'
export const APPLE_PENDING_CLAIM_MAX_AGE_SECONDS = 24 * 60 * 60

interface PendingClaimRow {
  id: string
  claim_token_hash: string
  apple_original_transaction_id: string
  apple_transaction_id: string
  apple_product_id: string
  apple_environment: string
  signed_transaction_info: string
  meta_event_id: string | null
  attribution: Record<string, unknown> | null
  expires_at: string
  claimed_by: string | null
  claimed_at: string | null
  created_at: string
}

export interface PendingAppleTrialClaimResult {
  result: AppleApplyResult
  metaEventId?: string
  attribution: Record<string, unknown>
}

function hashClaimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeAttribution(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    const serialized = JSON.stringify(value)
    return serialized.length <= 8_192 ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function preparePendingAppleTrialClaim(args: {
  signedTransactionInfo: string
  metaEventId?: string
  attribution?: Record<string, unknown>
}): Promise<{ claimToken: string; expiresAt: string }> {
  if (args.signedTransactionInfo.length > 32_768) {
    throw new Error('Apple transaction payload is too large')
  }

  const transaction = await verifyAppleTransaction(args.signedTransactionInfo)
  const verified = requireAppleBasicIntroTrial(transaction)
  if (transaction.appAccountToken) {
    throw new Error('This Apple purchase is already associated with a Makaron account. Sign in to restore it.')
  }

  const admin = getSupabaseAdmin()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + APPLE_PENDING_CLAIM_MAX_AGE_SECONDS * 1000)
  const claimToken = randomBytes(32).toString('base64url')
  const claimTokenHash = hashClaimToken(claimToken)

  // Best-effort cleanup keeps abandoned pre-registration purchases bounded.
  await admin
    .from('pending_apple_trial_claims')
    .delete()
    .lt('expires_at', now.toISOString())
    .is('claimed_at', null)

  const { data: existing, error: existingError } = await admin
    .from('pending_apple_trial_claims')
    .select('id, claimed_by, claimed_at')
    .eq('apple_original_transaction_id', verified.originalTransactionId)
    .maybeSingle()
  if (existingError) throw new Error(`Could not inspect pending Apple trial: ${existingError.message}`)
  if (existing?.claimed_at || existing?.claimed_by) {
    throw new Error('This Apple trial is already linked to a Makaron account')
  }

  const values = {
    claim_token_hash: claimTokenHash,
    apple_original_transaction_id: verified.originalTransactionId,
    apple_transaction_id: verified.transactionId,
    apple_product_id: verified.productId,
    apple_environment: verified.environment || 'Unknown',
    signed_transaction_info: args.signedTransactionInfo,
    meta_event_id: args.metaEventId?.slice(0, 255) || null,
    attribution: normalizeAttribution(args.attribution),
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
  }

  const write = existing
    ? admin.from('pending_apple_trial_claims').update(values).eq('id', existing.id)
    : admin.from('pending_apple_trial_claims').insert(values)
  const { error: writeError } = await write
  if (writeError) throw new Error(`Could not save pending Apple trial: ${writeError.message}`)

  return { claimToken, expiresAt: expiresAt.toISOString() }
}

export async function claimPendingAppleTrial(args: {
  claimToken: string
  userId: string
}): Promise<PendingAppleTrialClaimResult> {
  const admin = getSupabaseAdmin()
  const tokenHash = hashClaimToken(args.claimToken)
  const { data, error } = await admin
    .from('pending_apple_trial_claims')
    .select('*')
    .eq('claim_token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error(`Could not load pending Apple trial: ${error.message}`)
  if (!data) throw new Error('Pending Apple trial was not found')

  const pending = data as PendingClaimRow
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    throw new Error('Pending Apple trial expired. Restore the Apple purchase and try again.')
  }
  if (pending.claimed_by && pending.claimed_by !== args.userId) {
    throw new Error('This Apple trial is already linked to another Makaron account')
  }

  const transaction = await verifyAppleTransaction(pending.signed_transaction_info)
  const environment = (pending.apple_environment || '').toLowerCase()
  const acceleratedTestEnvironment = environment === 'sandbox'
    || environment === 'xcode'
    || environment === 'localtesting'
    || environment === 'local_testing'
  const verified = requireAppleBasicIntroTrial(transaction, {
    allowExpired: acceleratedTestEnvironment,
  })
  if (
    verified.originalTransactionId !== pending.apple_original_transaction_id
    || verified.transactionId !== pending.apple_transaction_id
    || verified.productId !== pending.apple_product_id
  ) {
    throw new Error('Pending Apple trial no longer matches the verified transaction')
  }
  if (transaction.appAccountToken && transaction.appAccountToken.toLowerCase() !== args.userId.toLowerCase()) {
    throw new Error('Apple transaction account token does not match the authenticated user')
  }

  const pendingCreatedAt = new Date(pending.created_at)
  if (
    acceleratedTestEnvironment
    && (!Number.isFinite(pendingCreatedAt.getTime()) || pendingCreatedAt.getTime() >= verified.expiresAt.getTime())
  ) {
    throw new Error('Sandbox introductory trial was not active when the pending claim was created')
  }
  const trialCreditExpiresAt = acceleratedTestEnvironment && verified.expiresAt.getTime() <= Date.now()
    ? new Date(Date.now() + IOS_TRIAL_DAYS * 24 * 60 * 60 * 1000)
    : verified.expiresAt

  // Existing transaction/user uniqueness constraints make retries idempotent
  // and prevent one StoreKit purchase from crediting two Makaron accounts.
  const result = await applyAppleTransaction({
    userId: args.userId,
    transaction,
    grantCredits: true,
    introTrialExpiresAtOverride: trialCreditExpiresAt,
  })

  if (!pending.claimed_at) {
    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await admin
      .from('pending_apple_trial_claims')
      .update({
        claimed_by: args.userId,
        claimed_at: claimedAt,
        updated_at: claimedAt,
      })
      .eq('id', pending.id)
      .is('claimed_at', null)
      .select('claimed_by')
      .maybeSingle()
    if (claimError) throw new Error(`Could not finish Apple trial link: ${claimError.message}`)
    if (!claimed) {
      const { data: latest } = await admin
        .from('pending_apple_trial_claims')
        .select('claimed_by')
        .eq('id', pending.id)
        .single()
      if (latest?.claimed_by !== args.userId) {
        throw new Error('Apple trial was linked by another account during registration')
      }
    }
  }

  return {
    result,
    metaEventId: pending.meta_event_id || undefined,
    attribution: pending.attribution || {},
  }
}
