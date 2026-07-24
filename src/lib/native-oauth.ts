'use client';

import { isMakaronIOSApp } from './native-app';

interface NativeOAuthResponse {
  id?: string;
  ok?: boolean;
  error?: string;
  callbackUrl?: string;
}

type NativeOAuthPayload = {
  id: string;
  action: 'openOAuth';
  url: string;
  callbackURLScheme: string;
};

let nativeMessageId = 0;

export function isNativeOAuthAvailable(): boolean {
  const webkit = typeof window !== 'undefined' ? (window as any).webkit : undefined;
  return typeof window !== 'undefined'
    && isMakaronIOSApp()
    && typeof webkit?.messageHandlers?.makaronNative?.postMessage === 'function';
}

export function openNativeOAuthSession(url: string, callbackURLScheme = 'app.makaron.ios'): Promise<string> {
  if (!isNativeOAuthAvailable()) {
    return Promise.reject(new Error('Native OAuth is not available in this runtime'));
  }

  const id = `oauth-${Date.now().toString(36)}-${(nativeMessageId += 1).toString(36)}`;
  const nativeMessage: NativeOAuthPayload = {
    id,
    action: 'openOAuth',
    url,
    callbackURLScheme,
  };

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('makaron-native-response', onResponse);
      reject(new Error('Google login timed out'));
    }, 180000);

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<NativeOAuthResponse>).detail;
      if (detail?.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('makaron-native-response', onResponse);
      if (detail.ok && detail.callbackUrl) {
        resolve(detail.callbackUrl);
      } else {
        reject(new Error(detail?.error || 'Google login was not completed'));
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
