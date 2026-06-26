export const MAKARON_IOS_USER_AGENT_TOKEN = 'MakaronIOS';

type CapacitorLike = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

export function userAgentHasMakaronIOSToken(userAgent: string | undefined): boolean {
  return Boolean(userAgent?.includes(MAKARON_IOS_USER_AGENT_TOKEN));
}

export function getNavigatorUserAgent(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent || '';
}

export function isCapacitorIOS(capacitor?: CapacitorLike | null): boolean {
  if (!capacitor?.getPlatform) return false;
  const isNative = capacitor.isNativePlatform?.() ?? false;
  return isNative && capacitor.getPlatform() === 'ios';
}

export function isMakaronIOSApp(options?: {
  capacitor?: CapacitorLike | null;
  userAgent?: string;
}): boolean {
  if (isCapacitorIOS(options?.capacitor)) return true;
  return userAgentHasMakaronIOSToken(options?.userAgent ?? getNavigatorUserAgent());
}

export function shouldSuppressWebBilling(options?: {
  capacitor?: CapacitorLike | null;
  userAgent?: string;
}): boolean {
  return isMakaronIOSApp(options);
}
