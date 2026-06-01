import { isMakaronIOSApp } from '@/lib/native-app';
import { requestNativePageStackBack } from '@/lib/native-page-stack';

interface NativeNavigationEnv {
  history?: Pick<History, 'length' | 'back'>;
  isIOSApp?: () => boolean;
  location?: Pick<Location, 'assign'>;
}

export function navigateBackInIOSApp(fallbackPath = '/projects', env: NativeNavigationEnv = {}): boolean {
  const history = env.history ?? (typeof window !== 'undefined' ? window.history : undefined);
  const location = env.location ?? (typeof window !== 'undefined' ? window.location : undefined);
  const isIOSApp = env.isIOSApp ?? isMakaronIOSApp;
  if (!history || !location || !isIOSApp()) return false;
  if (requestNativePageStackBack(fallbackPath, { isIOSApp })) return true;
  if (history.length > 1) {
    history.back();
  } else {
    location.assign(fallbackPath);
  }
  return true;
}
