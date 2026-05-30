'use client';

import { useEffect } from 'react';
import { calculateVisualViewportKeyboardInset } from '@/lib/ios-keyboard';
import { MAKARON_IOS_USER_AGENT_TOKEN } from '@/lib/native-app';

const IOS_BACK_SWIPE_EDGE_PX = 32;
const IOS_BACK_SWIPE_COMMIT_PX = 72;
const IOS_BACK_SWIPE_MIN_DX = 10;

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
      const cleanupBackSwipe = installIOSBackSwipe();

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
        cleanupBackSwipe();
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

function installIOSBackSwipe() {
  let tracking = false;
  let committed = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let startTime = 0;
  let overlay: HTMLDivElement | null = null;
  let navigatedBack = false;

  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
  };

  const createOverlay = () => {
    if (overlay) return overlay;

    const wrapper = document.createElement('div');
    const bodyClone = document.body.cloneNode(true) as HTMLElement;

    wrapper.dataset.makaronIosBackOverlay = 'true';
    wrapper.style.position = 'fixed';
    wrapper.style.inset = '0';
    wrapper.style.zIndex = '2147483647';
    wrapper.style.overflow = 'hidden';
    wrapper.style.background = '#000';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.transform = 'translate3d(0, 0, 0)';
    wrapper.style.transition = 'none';
    wrapper.style.willChange = 'transform';

    bodyClone.style.margin = '0';
    bodyClone.style.width = '100vw';
    bodyClone.style.minHeight = '100vh';
    bodyClone.style.transform = 'none';
    bodyClone.style.transition = 'none';
    bodyClone.style.pointerEvents = 'none';
    wrapper.appendChild(bodyClone);
    document.body.appendChild(wrapper);
    overlay = wrapper;
    return wrapper;
  };

  const setOverlayProgress = (distance: number) => {
    const activeOverlay = overlay ?? createOverlay();
    activeOverlay.style.transform = `translate3d(${Math.max(0, distance)}px, 0, 0)`;
  };

  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || isEditableTarget(event.target)) return;
    const touch = event.touches[0];
    if (touch.clientX > IOS_BACK_SWIPE_EDGE_PX) return;

    tracking = true;
    committed = false;
    navigatedBack = false;
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    startTime = performance.now();
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!tracking || committed || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    lastX = touch.clientX;

    if (dx <= IOS_BACK_SWIPE_MIN_DX || dx < Math.abs(dy) * 1.15) {
      if (Math.abs(dy) > IOS_BACK_SWIPE_MIN_DX && Math.abs(dy) > dx) {
        tracking = false;
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!overlay) {
      createOverlay();
      window.history.back();
      navigatedBack = true;
    }
    setOverlayProgress(Math.min(dx, window.innerWidth));
  };

  const finish = () => {
    if (!tracking) return;

    const dx = Math.max(0, lastX - startX);
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = dx / elapsed;
    const shouldGoBack = dx >= IOS_BACK_SWIPE_COMMIT_PX || velocity > 0.42;

    tracking = false;

    if (shouldGoBack) {
      committed = true;
      const activeOverlay = overlay;
      if (!navigatedBack) window.history.back();
      if (!activeOverlay) return;
      activeOverlay.style.transition = 'transform 160ms ease-out';
      activeOverlay.style.transform = `translate3d(${window.innerWidth}px, 0, 0)`;
      window.setTimeout(() => {
        removeOverlay();
      }, 120);
      return;
    }

    if (navigatedBack) window.history.forward();
    if (!overlay) return;
    overlay.style.transition = 'transform 180ms ease-out';
    overlay.style.transform = 'translate3d(0, 0, 0)';
    window.setTimeout(removeOverlay, 190);
  };

  const cancel = () => {
    if (!tracking) return;
    tracking = false;
    if (navigatedBack) window.history.forward();
    if (!overlay) return;
    overlay.style.transition = 'transform 160ms ease-out';
    overlay.style.transform = 'translate3d(0, 0, 0)';
    window.setTimeout(removeOverlay, 170);
  };

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', finish, { capture: true, passive: true });
  document.addEventListener('touchcancel', cancel, { capture: true, passive: true });

  return () => {
    document.removeEventListener('touchstart', onTouchStart, { capture: true });
    document.removeEventListener('touchmove', onTouchMove, { capture: true });
    document.removeEventListener('touchend', finish, { capture: true });
    document.removeEventListener('touchcancel', cancel, { capture: true });
    removeOverlay();
  };
}
