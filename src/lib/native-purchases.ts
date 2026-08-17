'use client';

import { isMakaronIOSApp } from './native-app';

export interface NativeAppleProduct {
  productId: string;
  displayName: string;
  description: string;
  displayPrice: string;
  type: string;
  isEligibleForIntroOffer?: boolean;
  introductoryOffer?: {
    displayPrice: string;
    paymentMode: 'freeTrial' | 'payAsYouGo' | 'payUpFront' | string;
    periodUnit: 'day' | 'week' | 'month' | 'year' | string;
    periodValue: number;
    periodCount: number;
  };
}

export interface NativeAppleTransaction {
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  signedTransactionInfo: string;
}

interface NativePurchaseResponse {
  id?: string;
  ok?: boolean;
  error?: string;
  products?: NativeAppleProduct[];
  transactions?: NativeAppleTransaction[];
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
}

type NativePurchasePayload = {
  id: string;
} & ({
  action: 'getProducts';
  productIds: string[];
} | {
  action: 'purchaseSubscription';
  productId: string;
  appAccountToken?: string;
} | {
  action: 'purchaseProduct';
  productId: string;
  appAccountToken?: string;
} | {
  action: 'restorePurchases';
} | {
  action: 'finishTransaction';
  transactionId: string;
});

type NativePurchaseMessage =
  | { action: 'getProducts'; productIds: string[] }
  | { action: 'purchaseSubscription'; productId: string; appAccountToken?: string }
  | { action: 'purchaseProduct'; productId: string; appAccountToken?: string }
  | { action: 'restorePurchases' }
  | { action: 'finishTransaction'; transactionId: string };

let nativeMessageId = 0;

export type NativeApplePurchaseErrorCode =
  | 'USER_CANCELLED'
  | 'PENDING'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'FAILED';

export class NativeApplePurchaseError extends Error {
  code: NativeApplePurchaseErrorCode;

  constructor(message: string, code: NativeApplePurchaseErrorCode = 'FAILED') {
    super(message);
    this.name = 'NativeApplePurchaseError';
    this.code = code;
  }
}

function nativePurchaseErrorCode(error?: string): NativeApplePurchaseErrorCode {
  if (error === 'Purchase cancelled') return 'USER_CANCELLED';
  if (error === 'Purchase pending') return 'PENDING';
  return 'FAILED';
}

export function isNativeApplePurchaseCancellation(error: unknown): boolean {
  return (error instanceof NativeApplePurchaseError && error.code === 'USER_CANCELLED')
    || (error instanceof Error && error.message === 'Purchase cancelled');
}

export function getNativeApplePurchaseErrorMessage(error: unknown, fallback: string): string {
  if (isNativeApplePurchaseCancellation(error)) {
    return 'Purchase was not completed. If you just signed in to Sandbox, tap the Apple purchase button again.';
  }
  if (error instanceof NativeApplePurchaseError && error.code === 'PENDING') {
    return 'Purchase is pending approval in Apple. Please check again shortly.';
  }
  return error instanceof Error ? error.message : fallback;
}

export function isNativeApplePurchaseAvailable(): boolean {
  const webkit = typeof window !== 'undefined' ? (window as any).webkit : undefined;
  return typeof window !== 'undefined'
    && isMakaronIOSApp()
    && typeof webkit?.messageHandlers?.makaronNative?.postMessage === 'function';
}

function sendNativePurchaseMessage<T>(message: NativePurchaseMessage, timeoutMs = 120000): Promise<T> {
  if (!isNativeApplePurchaseAvailable()) {
    return Promise.reject(new NativeApplePurchaseError('Apple in-app purchase is not available in this runtime', 'UNAVAILABLE'));
  }

  const id = `iap-${Date.now().toString(36)}-${(nativeMessageId += 1).toString(36)}`;
  const nativeMessage = { ...message, id } as NativePurchasePayload;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('makaron-native-response', onResponse);
      reject(new NativeApplePurchaseError('Apple purchase request timed out', 'TIMEOUT'));
    }, timeoutMs);

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<NativePurchaseResponse>).detail;
      if (detail?.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('makaron-native-response', onResponse);
      if (detail.ok) {
        resolve(detail as T);
      } else {
        const message = detail?.error || 'Apple purchase request failed';
        reject(new NativeApplePurchaseError(message, nativePurchaseErrorCode(detail?.error)));
      }
    }

    window.addEventListener('makaron-native-response', onResponse);
    try {
      (window as any).webkit?.messageHandlers?.makaronNative?.postMessage(nativeMessage);
    } catch (error) {
      window.clearTimeout(timeout);
      window.removeEventListener('makaron-native-response', onResponse);
      reject(error);
    }
  });
}

export async function getNativeAppleProducts(productIds: string[]): Promise<NativeAppleProduct[]> {
  const result = await sendNativePurchaseMessage<NativePurchaseResponse>({
    action: 'getProducts',
    productIds,
  }, 45000);
  return result.products || [];
}

export async function purchaseNativeAppleProduct(productId: string, appAccountToken?: string): Promise<NativeAppleTransaction> {
  const result = await sendNativePurchaseMessage<NativePurchaseResponse>({
    action: 'purchaseProduct',
    productId,
    appAccountToken,
  });
  if (!result.signedTransactionInfo || !result.transactionId || !result.originalTransactionId || !result.productId) {
    throw new Error('Native purchase returned incomplete transaction data');
  }
  return {
    productId: result.productId,
    transactionId: result.transactionId,
    originalTransactionId: result.originalTransactionId,
    signedTransactionInfo: result.signedTransactionInfo,
  };
}

export async function purchaseNativeAppleSubscription(productId: string, appAccountToken?: string): Promise<NativeAppleTransaction> {
  return purchaseNativeAppleProduct(productId, appAccountToken);
}

export async function restoreNativeApplePurchases(): Promise<NativeAppleTransaction[]> {
  const result = await sendNativePurchaseMessage<NativePurchaseResponse>({
    action: 'restorePurchases',
  }, 120000);
  return result.transactions || [];
}

export async function finishNativeAppleTransaction(transactionId: string): Promise<void> {
  await sendNativePurchaseMessage<NativePurchaseResponse>({
    action: 'finishTransaction',
    transactionId,
  }, 45000);
}
