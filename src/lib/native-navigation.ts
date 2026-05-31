import { isMakaronIOSApp } from '@/lib/native-app';

export function navigateBackInIOSApp(fallbackPath = '/projects'): boolean {
  if (typeof window === 'undefined' || !isMakaronIOSApp()) return false;
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.assign(fallbackPath);
  }
  return true;
}
