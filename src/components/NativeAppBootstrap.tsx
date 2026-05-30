'use client';

import { useEffect } from 'react';
import { calculateVisualViewportKeyboardInset } from '@/lib/ios-keyboard';
import { MAKARON_IOS_USER_AGENT_TOKEN } from '@/lib/native-app';

export default function NativeAppBootstrap() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    async function bootNativeApp() {
      const [{ Capacitor }, keyboardModule, { SplashScreen }, statusBarModule] = await Promise.all([
        import('@capacitor/core'),
        import('@capacitor/keyboard'),
        import('@capacitor/splash-screen'),
        import('@capacitor/status-bar'),
      ]);
      const { Keyboard, KeyboardResize, KeyboardStyle } = keyboardModule;
      const { StatusBar, Style } = statusBarModule;

      if (cancelled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;

      document.documentElement.classList.add('makaron-ios-app');
      document.documentElement.dataset.nativePlatform = 'ios';

      const userAgent = navigator.userAgent || '';
      if (!userAgent.includes(MAKARON_IOS_USER_AGENT_TOKEN)) {
        document.documentElement.dataset.nativeUserAgentFallback = 'missing';
      }

      try {
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setBackgroundColor({ color: '#000000' });
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Native UI polish should never block the web app.
      }

      try {
        await Keyboard.setResizeMode({ mode: KeyboardResize.None });
        await Keyboard.setStyle({ style: KeyboardStyle.Dark });
      } catch {
        // Some simulator/runtime combinations do not expose keyboard controls.
      }

      const setInset = (inset: number) => {
        const roundedInset = Math.max(0, Math.round(inset));
        document.documentElement.style.setProperty('--makaron-native-keyboard-inset', `${roundedInset}px`);
        window.dispatchEvent(new CustomEvent('makaron-keyboard-inset-change', {
          detail: { inset: roundedInset },
        }));
      };

      const updateFromViewport = () => {
        const vv = window.visualViewport;
        if (!vv) return;
        setInset(calculateVisualViewportKeyboardInset({
          layoutHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
        }));
      };

      const keyboardShow = await Keyboard.addListener('keyboardWillShow', (info) => {
        setInset(info.keyboardHeight);
      });
      const keyboardHide = await Keyboard.addListener('keyboardWillHide', () => {
        setInset(0);
      });

      window.visualViewport?.addEventListener('resize', updateFromViewport);
      window.visualViewport?.addEventListener('scroll', updateFromViewport);
      updateFromViewport();

      try {
        await SplashScreen.hide();
      } catch {
        // The bundled web shell remains usable if splash hide is already complete.
      }

      cleanup = () => {
        keyboardShow.remove();
        keyboardHide.remove();
        window.visualViewport?.removeEventListener('resize', updateFromViewport);
        window.visualViewport?.removeEventListener('scroll', updateFromViewport);
        setInset(0);
      };
    }

    bootNativeApp().catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
