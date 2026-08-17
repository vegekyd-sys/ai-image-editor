import {
  OfferType,
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import { getBalance } from './credits'
import {
  getAppleSubscriptionProducts,
  getAppleTopUpProducts,
  getPlanByAppleProductId,
  getTopUpByAppleProductId,
} from './plans'
import { upsertAppleSubscription } from './subscription'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { DEFAULT_IOS_TRIAL_CREDITS, IOS_TRIAL_DAYS, getConfiguredIOSTrialCredits } from './ios-trial'

type AppleEnvironment = Environment.SANDBOX | Environment.PRODUCTION | Environment.XCODE | Environment.LOCAL_TESTING

export interface AppleApplyResult {
  transaction: JWSTransactionDecodedPayload
  purchaseType: 'subscription' | 'topup'
  credited: boolean
  credits: number
  amountUsd: number
  productId: string
  transactionId: string
  originalTransactionId: string
  planId?: string
  billingInterval?: 'month' | 'year'
  tierId?: string
  balance: Awaited<ReturnType<typeof getBalance>>
}

function parseAppleEnvironment(value?: string | null): AppleEnvironment {
  const normalized = (value || '').toLowerCase()
  if (normalized === 'production' || normalized === 'prod') return Environment.PRODUCTION
  if (normalized === 'xcode') return Environment.XCODE
  if (normalized === 'localtesting' || normalized === 'local_testing' || normalized === 'local-testing') return Environment.LOCAL_TESTING
  return Environment.SANDBOX
}

function getBundleId(): string {
  return process.env.APPLE_BUNDLE_ID || 'app.makaron.ios'
}

function getAppAppleId(): number | undefined {
  const raw = process.env.APPLE_APP_APPLE_ID || process.env.APPLE_APP_ID
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function pemBlocksToDer(pem: string): Buffer[] {
  const normalized = pem.replace(/\\n/g, '\n')
  const matches = normalized.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []
  return matches.map(block => Buffer.from(
    block
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, ''),
    'base64',
  ))
}

function loadAppleRootCertificates(): Buffer[] {
  const pem = process.env.APPLE_ROOT_CERTIFICATES_PEM
  if (pem) {
    const certs = pemBlocksToDer(pem)
    if (certs.length > 0) return certs
  }

  const base64 = process.env.APPLE_ROOT_CERTIFICATES_BASE64
  if (base64) {
    return base64
      .split(/[\n,;]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => Buffer.from(part, 'base64'))
  }

  throw new Error('APPLE_ROOT_CERTIFICATES_PEM or APPLE_ROOT_CERTIFICATES_BASE64 is required')
}

function getVerifier(environment: AppleEnvironment): SignedDataVerifier {
  const appAppleId = getAppAppleId()
  const rootCertificates = environment === Environment.XCODE || environment === Environment.LOCAL_TESTING
    ? []
    : loadAppleRootCertificates()

  return new SignedDataVerifier(
    rootCertificates,
    process.env.APPLE_ENABLE_ONLINE_CERT_CHECKS !== 'false',
    environment,
    getBundleId(),
    environment === Environment.PRODUCTION ? appAppleId : undefined,
  )
}

function getVerifierEnvironments(): AppleEnvironment[] {
  const configured = process.env.APPLE_IAP_ENVIRONMENTS || process.env.APPLE_IAP_ENVIRONMENT
  const list = configured
    ? configured.split(/[,;]+/).map(value => parseAppleEnvironment(value.trim()))
    : [Environment.SANDBOX, Environment.PRODUCTION]

  return Array.from(new Set(list)).filter(env => {
    if (env !== Environment.PRODUCTION) return true
    return Boolean(getAppAppleId())
  })
}

export function getConfiguredAppleProducts(trialCredits = DEFAULT_IOS_TRIAL_CREDITS) {
  return [
    ...getAppleSubscriptionProducts().map(product => ({
      ...product,
      kind: 'subscription' as const,
      ...(product.planId === 'basic' && product.interval === 'month'
        ? { introTrial: { days: IOS_TRIAL_DAYS, credits: trialCredits } }
        : {}),
    })),
    ...getAppleTopUpProducts().map(product => ({ ...product, kind: 'topup' as const })),
  ]
}

export async function verifyAppleTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload> {
  let lastError: unknown
  for (const environment of getVerifierEnvironments()) {
    try {
      return await getVerifier(environment).verifyAndDecodeTransaction(signedTransactionInfo)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Apple transaction verification failed')
}

export async function verifyAppleNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  let lastError: unknown
  for (const environment of getVerifierEnvironments()) {
    try {
      return await getVerifier(environment).verifyAndDecodeNotification(signedPayload)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Apple notification verification failed')
}

function getTransactionStatus(transaction: JWSTransactionDecodedPayload): string {
  if (transaction.revocationDate) return 'refunded'
  if (transaction.expiresDate && transaction.expiresDate <= Date.now()) return 'expired'
  return 'active'
}

function getCreditsForApplePurchase(planId: string, interval: 'month' | 'year'): number {
  const product = getAppleSubscriptionProducts().find(p => p.planId === planId && p.interval === interval)
  return product?.credits ?? 0
}

function getAmountUsdForApplePurchase(planId: string, interval: 'month' | 'year'): number {
  const product = getAppleSubscriptionProducts().find(p => p.planId === planId && p.interval === interval)
  return product ? product.price / 100 : 0
}

function getTransactionEnvironment(transaction: JWSTransactionDecodedPayload): string | null {
  return transaction.environment ? String(transaction.environment) : null
}

async function grantAppleCredits(args: {
  userId: string
  transactionId: string
  originalTransactionId: string
  productId: string
  environment: string | null
  credits: number
  amountUsd: number
  source: 'trial' | 'subscription' | 'subscription_annual' | 'topup'
  trialExpiresAt?: Date | null
}): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('grant_apple_credits_and_record_purchase', {
    p_user_id: args.userId,
    p_credits: args.credits,
    p_amount_usd: args.amountUsd,
    p_transaction_id: args.transactionId,
    p_original_transaction_id: args.originalTransactionId,
    p_product_id: args.productId,
    p_environment: args.environment,
    p_source: args.source,
    p_trial_expires_at: args.trialExpiresAt?.toISOString() ?? null,
  })
  if (error) throw new Error(`Could not grant Apple credits: ${error.message}`)
  return data?.granted === true
}

function isUuid(value?: string | null): value is string {
  return Boolean(value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
}

export async function resolveUserIdForAppleTransaction(transaction: JWSTransactionDecodedPayload): Promise<string | null> {
  if (isUuid(transaction.appAccountToken)) return transaction.appAccountToken
  if (!transaction.originalTransactionId) return null

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', transaction.originalTransactionId)
    .single()

  return data?.user_id ?? null
}

export async function applyAppleTransaction(args: {
  userId: string
  transaction: JWSTransactionDecodedPayload
  grantCredits: boolean
}): Promise<AppleApplyResult> {
  const { userId, transaction, grantCredits } = args
  const productId = transaction.productId
  const transactionId = transaction.transactionId
  const originalTransactionId = transaction.originalTransactionId || transactionId
  if (!productId || !transactionId || !originalTransactionId) {
    throw new Error('Apple transaction is missing productId or transactionId')
  }

  if (transaction.appAccountToken && transaction.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    throw new Error('Apple transaction account token does not match the authenticated user')
  }

  const baseStatus = getTransactionStatus(transaction)
  const environment = getTransactionEnvironment(transaction)
  const planMatch = getPlanByAppleProductId(productId)

  if (!planMatch) {
    const topUp = getTopUpByAppleProductId(productId)
    if (!topUp) throw new Error(`Unknown Apple product ID: ${productId}`)

    let credited = false
    if (grantCredits && baseStatus === 'active' && topUp.credits > 0) {
      credited = await grantAppleCredits({
        userId,
        transactionId,
        originalTransactionId,
        productId,
        environment,
        credits: topUp.credits,
        amountUsd: topUp.price / 100,
        source: 'topup',
      })
    }

    const balance = await getBalance(userId)
    return {
      transaction,
      purchaseType: 'topup',
      credited,
      credits: credited ? topUp.credits : 0,
      amountUsd: topUp.price / 100,
      productId,
      transactionId,
      originalTransactionId,
      tierId: topUp.tierId,
      balance,
    }
  }

  const currentPeriodStart = transaction.purchaseDate ? new Date(transaction.purchaseDate) : null
  const currentPeriodEnd = transaction.expiresDate ? new Date(transaction.expiresDate) : null
  const isIntroTrial = planMatch.plan.id === 'basic'
    && planMatch.interval === 'month'
    && transaction.offerType === OfferType.INTRODUCTORY_OFFER
  if (isIntroTrial && !currentPeriodEnd) {
    throw new Error('Apple introductory trial is missing an expiry date')
  }
  const status = baseStatus === 'active' && isIntroTrial ? 'trialing' : baseStatus

  await upsertAppleSubscription({
    userId,
    originalTransactionId,
    transactionId,
    productId,
    planId: planMatch.plan.id,
    billingInterval: planMatch.interval,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    appAccountToken: transaction.appAccountToken ?? userId,
    environment,
  })

  let credited = false
  const credits = isIntroTrial
    ? await getConfiguredIOSTrialCredits(getSupabaseAdmin())
    : getCreditsForApplePurchase(planMatch.plan.id, planMatch.interval)
  const amountUsd = isIntroTrial ? 0 : getAmountUsdForApplePurchase(planMatch.plan.id, planMatch.interval)

  if (grantCredits && (status === 'active' || status === 'trialing') && credits > 0) {
    credited = await grantAppleCredits({
      userId,
      transactionId,
      originalTransactionId,
      productId,
      environment,
      credits,
      amountUsd,
      source: isIntroTrial ? 'trial' : planMatch.interval === 'year' ? 'subscription_annual' : 'subscription',
      trialExpiresAt: isIntroTrial ? currentPeriodEnd : null,
    })
  }

  const balance = await getBalance(userId)
  return {
    transaction,
    purchaseType: 'subscription',
    credited,
    credits: credited ? credits : 0,
    amountUsd,
    productId,
    transactionId,
    originalTransactionId,
    planId: planMatch.plan.id,
    billingInterval: planMatch.interval,
    balance,
  }
}

export async function applyAppleSignedTransaction(args: {
  userId: string
  signedTransactionInfo: string
  grantCredits?: boolean
}): Promise<AppleApplyResult> {
  const transaction = await verifyAppleTransaction(args.signedTransactionInfo)
  return applyAppleTransaction({
    userId: args.userId,
    transaction,
    grantCredits: args.grantCredits ?? true,
  })
}

export function shouldGrantCreditsForNotification(type?: string): boolean {
  return type === NotificationTypeV2.SUBSCRIBED
    || type === NotificationTypeV2.DID_RENEW
    || type === NotificationTypeV2.OFFER_REDEEMED
}

export function notificationStatusOverride(type?: string): string | null {
  if (type === NotificationTypeV2.EXPIRED || type === NotificationTypeV2.GRACE_PERIOD_EXPIRED) return 'expired'
  if (type === NotificationTypeV2.DID_FAIL_TO_RENEW) return 'past_due'
  if (type === NotificationTypeV2.REFUND || type === NotificationTypeV2.REVOKE) return 'refunded'
  return null
}
