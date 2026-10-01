import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIOSAIConsentAppBuild, requiresIOSAIDataConsent } from '@/lib/ios-ai-consent';

const appInfo = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app', () => ({ App: { getInfo: appInfo } }));
afterEach(() => { vi.useRealTimers(); appInfo.mockReset(); });

describe('iOS consent build policy', () => {
  it.each(['all', '', ' ', '18,', 'bogus', '-1', '18.0'])('retains the page for default or invalid policy %s', policy => {
    expect(requiresIOSAIDataConsent(policy, '17')).toBe(true);
  });
  it('matches exact builds and supports multiple current builds', () => {
    expect(requiresIOSAIDataConsent('18', '17')).toBe(false);
    expect(requiresIOSAIDataConsent('18', '18')).toBe(true);
    expect(requiresIOSAIDataConsent('18', '118')).toBe(false);
    expect(requiresIOSAIDataConsent('18, 19', '19')).toBe(true);
    expect(requiresIOSAIDataConsent('18, 19', '20')).toBe(false);
  });
  it.each([undefined, '', 'unknown', '17.0'])('retains the page for unknown build %s', build => {
    expect(requiresIOSAIDataConsent('18', build)).toBe(true);
  });
  it('only disables all builds through an explicit none policy', () => {
    expect(requiresIOSAIDataConsent('none')).toBe(false);
  });
  it('reads the existing App plugin without new native capability metadata', async () => {
    appInfo.mockResolvedValue({ id: 'app.makaron.ios', build: '17' });
    expect(await getIOSAIConsentAppBuild()).toBe('17');
    appInfo.mockResolvedValue({ id: 'different.app', build: '17' });
    expect(await getIOSAIConsentAppBuild()).toBeUndefined();
    appInfo.mockRejectedValue(new Error('Unavailable'));
    expect(await getIOSAIConsentAppBuild()).toBeUndefined();
  });
  it('does not hang the app if the plugin never responds', async () => {
    vi.useFakeTimers();
    appInfo.mockImplementation(() => new Promise(() => {}));
    const build = getIOSAIConsentAppBuild();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await build).toBeUndefined();
  });
});
