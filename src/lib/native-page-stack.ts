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

function pathnameForNativeStack(path: string): string {
  if (!path) return '/';
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://www.makaron.app';
    return new URL(path, base).pathname;
  } catch {
    return path.split('?')[0] || '/';
  }
}

export function shouldUseNativePageStack(path: string): boolean {
  const pathname = pathnameForNativeStack(path);
  if (pathname === '/' || pathname === '/home' || pathname === '/projects') return true;
  if (pathname.startsWith('/home/') || pathname.startsWith('/projects/')) return false;
  return true;
}

export function requestNativePageStackPush(path: string, env: NativePageStackEnv = {}): boolean {
  const targetWindow = env.window ?? (typeof window !== 'undefined' ? window : undefined);
  const isIOSApp = env.isIOSApp ?? isNativeIOSAppRuntime;
  if (!targetWindow || !isIOSApp() || !shouldUseNativePageStack(path)) return false;
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
