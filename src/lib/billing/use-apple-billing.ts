'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getNativeAppleProducts,
  isNativeApplePurchaseAvailable,
  type NativeAppleProduct,
} from '@/lib/native-purchases';

export interface AppleBillingProduct {
  kind: 'subscription' | 'topup';
  planId?: string;
  tierId?: string;
  name: string;
  interval?: 'month' | 'year';
  productId: string;
  credits: number;
  price: number;
  introTrial?: {
    days: number;
    credits: number;
  };
}

interface UseAppleBillingProductsOptions {
  enabled?: boolean;
}

export function findAppleTopupProduct(products: AppleBillingProduct[], tierId: string) {
  return products.find(product => product.kind === 'topup' && product.tierId === tierId);
}

export function findAppleSubscriptionProduct(
  products: AppleBillingProduct[],
  planId: string,
  interval: 'month' | 'year',
) {
  return products.find(product => (
    product.kind === 'subscription'
    && product.planId === planId
    && product.interval === interval
  ));
}

export function useAppleBillingProducts(options: UseAppleBillingProductsOptions = {}) {
  const { enabled = true } = options;
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<AppleBillingProduct[]>([]);
  const [nativeProducts, setNativeProducts] = useState<Record<string, NativeAppleProduct>>({});
  const [appAccountToken, setAppAccountToken] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(isNativeApplePurchaseAvailable());
  }, []);

  useEffect(() => {
    if (!enabled || !available) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetch('/api/billing/apple/products')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Apple products are not configured.');
        return data as { appAccountToken?: string; products?: AppleBillingProduct[] };
      })
      .then(async data => {
        if (cancelled) return;
        const billingProducts = data.products || [];
        setProducts(billingProducts);
        setAppAccountToken(data.appAccountToken);

        if (billingProducts.length === 0) {
          setNativeProducts({});
          return;
        }

        const nativeProductList = await getNativeAppleProducts(billingProducts.map(product => product.productId));
        if (cancelled) return;
        setNativeProducts(Object.fromEntries(nativeProductList.map(product => [product.productId, product])));
      })
      .catch(loadError => {
        console.error('[billing/apple] product load failed:', loadError);
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Apple purchases are not ready yet.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, available]);

  return useMemo(() => ({
    available,
    loading,
    products,
    nativeProducts,
    appAccountToken,
    error,
    findTopup: (tierId: string) => findAppleTopupProduct(products, tierId),
    findSubscription: (planId: string, interval: 'month' | 'year') => (
      findAppleSubscriptionProduct(products, planId, interval)
    ),
    nativeProductFor: (product?: AppleBillingProduct) => (
      product ? nativeProducts[product.productId] : undefined
    ),
  }), [appAccountToken, available, error, loading, nativeProducts, products]);
}
