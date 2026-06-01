import { describe, expect, it, vi } from 'vitest';
import {
  readNativeJSONCache,
  removeNativeJSONCache,
  writeNativeJSONCache,
} from '@/lib/native-app-cache';
import {
  MAKARON_IOS_USER_AGENT_TOKEN,
  isCapacitorIOS,
  isMakaronIOSApp,
  shouldSuppressWebBilling,
  userAgentHasMakaronIOSToken,
} from '@/lib/native-app';
import {
  cacheProjectsList,
  clearUserCache,
  getCachedProjectsListSync,
  getLastProjectsListSync,
} from '@/lib/imageCache';

describe('iOS native app detection', () => {
  it('detects the Makaron iOS user-agent token', () => {
    expect(userAgentHasMakaronIOSToken(`Mobile Safari ${MAKARON_IOS_USER_AGENT_TOKEN}`)).toBe(true);
    expect(userAgentHasMakaronIOSToken('Mobile Safari')).toBe(false);
  });

  it('detects native iOS through Capacitor when available', () => {
    expect(isCapacitorIOS({
      getPlatform: () => 'ios',
      isNativePlatform: () => true,
    })).toBe(true);

    expect(isCapacitorIOS({
      getPlatform: () => 'web',
      isNativePlatform: () => false,
    })).toBe(false);
  });

  it('uses either Capacitor or user-agent fallback for iOS app mode', () => {
    expect(isMakaronIOSApp({
      capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true },
      userAgent: '',
    })).toBe(true);

    expect(isMakaronIOSApp({
      capacitor: null,
      userAgent: `Mozilla/5.0 ${MAKARON_IOS_USER_AGENT_TOKEN}`,
    })).toBe(true);
  });

  it('suppresses web billing inside iOS app mode only', () => {
    expect(shouldSuppressWebBilling({ userAgent: `App ${MAKARON_IOS_USER_AGENT_TOKEN}` })).toBe(true);
    expect(shouldSuppressWebBilling({ userAgent: 'Mozilla/5.0 Safari' })).toBe(false);
  });

  it('keeps a synchronous session fallback for the iOS projects page', async () => {
    clearUserCache();

    const projects = [{
      id: 'project-1',
      title: 'Cached Project',
      cover_url: null,
      updated_at: '2026-05-31T00:00:00.000Z',
      created_at: '2026-05-31T00:00:00.000Z',
      snapshots: [{ id: 'snap-1', image_url: 'https://cdn.makaron.app/snap.jpg', sort_order: 0 }],
    }];

    cacheProjectsList('user-1', projects);

    expect(getCachedProjectsListSync('user-1')).toEqual(projects);
    expect(getLastProjectsListSync()).toEqual({ userId: 'user-1', projects });
    expect(localStorage.getItem('makaron:last-projects-list:persistent')).toContain('Cached Project');

    sessionStorage.clear();

    vi.resetModules();
    const freshImageCache = await import('@/lib/imageCache');
    expect(freshImageCache.getCachedProjectsListSync('user-1')).toEqual(projects);
    expect(sessionStorage.getItem('makaron:last-projects-list')).toContain('Cached Project');

    freshImageCache.clearUserCache();

    expect(freshImageCache.getCachedProjectsListSync('user-1')).toBeNull();
    expect(freshImageCache.getLastProjectsListSync()).toBeNull();
    expect(localStorage.getItem('makaron:last-projects-list:persistent')).toBeNull();
  });

  it('persists native JSON cache across WebView session resets', () => {
    sessionStorage.clear();
    localStorage.clear();

    writeNativeJSONCache('/api/billing/dashboard', { balance: 123 });
    sessionStorage.clear();

    expect(readNativeJSONCache<{ balance: number }>('/api/billing/dashboard')).toEqual({ balance: 123 });
    expect(sessionStorage.getItem('makaron:native-cache:/api/billing/dashboard')).toContain('"balance":123');

    removeNativeJSONCache('/api/billing/dashboard');
    expect(readNativeJSONCache('/api/billing/dashboard')).toBeNull();
    expect(localStorage.getItem('makaron:native-cache:/api/billing/dashboard')).toBeNull();
  });
});
