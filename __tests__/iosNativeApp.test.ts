import { describe, expect, it } from 'vitest';
import {
  MAKARON_IOS_USER_AGENT_TOKEN,
  isCapacitorIOS,
  isMakaronIOSApp,
  shouldSuppressWebBilling,
  userAgentHasMakaronIOSToken,
} from '@/lib/native-app';

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
});
