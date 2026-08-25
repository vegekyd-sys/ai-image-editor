import type { NativeAppleProduct } from '@/lib/native-purchases'
import type { AppleBillingProduct } from './use-apple-billing'

export interface EligibleAppleIntroTrial {
  days: number
  credits: number
  renewalPrice: string
}

function normalizeStoreKitValue(value: string): string {
  return value.replace(/[^a-z]/gi, '').toLowerCase()
}

export function getEligibleAppleIntroTrial(
  product?: AppleBillingProduct,
  nativeProduct?: NativeAppleProduct,
): EligibleAppleIntroTrial | null {
  const configured = product?.introTrial
  const offer = nativeProduct?.introductoryOffer
  if (
    product?.kind !== 'subscription'
    || product.planId !== 'basic'
    || product.interval !== 'month'
    || !configured
    || !nativeProduct?.isEligibleForIntroOffer
    || !offer
    || normalizeStoreKitValue(offer.paymentMode) !== 'freetrial'
    || normalizeStoreKitValue(offer.periodUnit) !== 'day'
    || offer.periodValue * offer.periodCount !== configured.days
  ) {
    return null
  }

  return {
    days: configured.days,
    credits: configured.credits,
    renewalPrice: nativeProduct.displayPrice,
  }
}
