import { describe, expect, it } from 'vitest';
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

  it('keeps a synchronous session fallback for the iOS projects page', () => {
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

    clearUserCache();

    expect(getCachedProjectsListSync('user-1')).toBeNull();
    expect(getLastProjectsListSync()).toBeNull();
  });
});
