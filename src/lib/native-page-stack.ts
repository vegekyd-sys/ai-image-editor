'use client';

import { isMakaronIOSApp } from '@/lib/native-app';

export const NATIVE_PAGE_STACK_PUSH_EVENT = 'makaron-ios-page-stack-push';
export const NATIVE_PAGE_STACK_BACK_EVENT = 'makaron-ios-page-stack-back';

interface NativePageStackEnv {
  isIOSApp?: () => boolean;
  window?: Pick<Window, 'dispatchEvent'>;
}

function isNativeIOSAppRuntime(): boolean {
  if (isMakaronIOSApp()) return true;
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.nativePlatform === 'ios';
}

export function requestNativePageStackPush(path: string, env: NativePageStackEnv = {}): boolean {
  const targetWindow = env.window ?? (typeof window !== 'undefined' ? window : undefined);
  const isIOSApp = env.isIOSApp ?? isNativeIOSAppRuntime;
  if (!targetWindow || !isIOSApp()) return false;
  targetWindow.dispatchEvent(new CustomEvent(NATIVE_PAGE_STACK_PUSH_EVENT, {
    detail: { path },
  }));
  return true;
}

export function requestNativePageStackBack(fallbackPath = '/projects', env: NativePageStackEnv = {}): boolean {
  const targetWindow = env.window ?? (typeof window !== 'undefined' ? window : undefined);
  const isIOSApp = env.isIOSApp ?? isNativeIOSAppRuntime;
  if (!targetWindow || !isIOSApp()) return false;
  const event = new CustomEvent(NATIVE_PAGE_STACK_BACK_EVENT, {
    cancelable: true,
    detail: { fallbackPath },
  });
  return !targetWindow.dispatchEvent(event);
}
