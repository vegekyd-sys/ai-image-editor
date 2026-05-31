'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { calculateVisualViewportKeyboardInset } from '@/lib/ios-keyboard';
import { MAKARON_IOS_USER_AGENT_TOKEN } from '@/lib/native-app';
import { warmNativeJSONCache } from '@/lib/native-app-cache';
import { isNativePhotoLibraryPickerAvailable, pickMediaFromNativePhotoLibrary } from '@/lib/native-media';
import { acceptsNativeMediaPickerAccept, nativePickerAllowsVideo } from '@/lib/native-photo-picker';

const NATIVE_BOOT_LOG_SESSION_KEY = 'makaron:ios-native-boot-log';
const IOS_PAGE_BACK_EDGE_PX = 32;
const IOS_PAGE_BACK_LOCK_PX = 12;
const IOS_PAGE_BACK_COMMIT_PX = 92;
const IOS_PAGE_BACK_SETTLE_MS = 180;
const NATIVE_APP_PREFETCH_ROUTES = ['/home', '/projects', '/dashboard', '/profile', '/skills'];
const NATIVE_APP_WARM_API_PATHS = ['/api/home-skills', '/api/skills', '/api/billing/credits', '/api/billing/dashboard'];

let hasWarmedNativeAppShell = false;

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function shouldUsePageBackGesture(): boolean {
  const path = window.location.pathname;
  if (path === '/' || path === '/home' || path.startsWith('/home/')) return false;
  if (path === '/projects' || path.startsWith('/projects/')) return false;
  if (document.querySelector('.makaron-editor-shell')) return false;
  if (document.querySelector('[data-makaron-ios-project-overlay]')) return false;
  if (document.querySelector('[data-makaron-cui-pan]')) return false;
  if (document.querySelector('.mkr-detail-snap')) return false;
  return true;
}

function warmNativeAppShell(router: ReturnType<typeof useRouter>) {
  if (hasWarmedNativeAppShell) return;
  hasWarmedNativeAppShell = true;

  const run = () => {
    NATIVE_APP_PREFETCH_ROUTES.forEach((route) => {
      try {
        router.prefetch(route);
      } catch {
        // Route prefetch is opportunistic app polish.
      }
    });
    NATIVE_APP_WARM_API_PATHS.forEach((path) => {
      warmNativeJSONCache(path);
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    globalThis.setTimeout(run, 600);
  }
}

function acceptsNativePhotoPicker(input: HTMLInputElement): boolean {
  if (input.type !== 'file' || input.disabled) return false;
  if (typeof DataTransfer === 'undefined' || typeof File === 'undefined' || typeof fetch === 'undefined') return false;
  return acceptsNativeMediaPickerAccept(input.accept);
}

async function fileFromDataUrl(dataUrl: string, filename: string, mimeType: string): Promise<File> {
  const blob = await fetch(dataUrl).then((res) => res.blob());
  return new File([blob], filename, { type: mimeType || blob.type || 'image/jpeg' });
}

export default function NativeAppBootstrap() {
  const router = useRouter();

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
      const target = window as typeof window & { __makaronNativeBootId?: string };
      target.__makaronNativeBootId = target.__makaronNativeBootId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const bootLogEntry = {
        bootId: target.__makaronNativeBootId,
        href: window.location.href,
        userAgent: navigator.userAgent,
        t: Math.round(performance.now()),
      };
      try {
        const previous = JSON.parse(sessionStorage.getItem(NATIVE_BOOT_LOG_SESSION_KEY) || '[]') as typeof bootLogEntry[];
        sessionStorage.setItem(NATIVE_BOOT_LOG_SESSION_KEY, JSON.stringify([...previous, bootLogEntry].slice(-20)));
      } catch {
        // Persistent diagnostics are best-effort only.
      }
      console.info('[makaron-ios-native] boot', bootLogEntry);

      const userAgent = navigator.userAgent || '';
      if (!userAgent.includes(MAKARON_IOS_USER_AGENT_TOKEN)) {
        document.documentElement.dataset.nativeUserAgentFallback = 'missing';
      }
      warmNativeAppShell(router);

      const pageBackPan = {
        tracking: false,
        locked: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        startTime: 0,
        target: null as HTMLElement | null,
        originalTransform: '',
        originalTransition: '',
        originalWillChange: '',
        originalBoxShadow: '',
      };
      let pageBackRestoreTimer: number | undefined;
      const resetPageBackPan = () => {
        pageBackPan.tracking = false;
        pageBackPan.locked = false;
        pageBackPan.startX = 0;
        pageBackPan.startY = 0;
        pageBackPan.lastX = 0;
        pageBackPan.startTime = 0;
      };
      const restorePageBackTarget = () => {
        if (pageBackRestoreTimer !== undefined) {
          window.clearTimeout(pageBackRestoreTimer);
          pageBackRestoreTimer = undefined;
        }
        const target = pageBackPan.target;
        if (!target) return;
        target.style.transform = pageBackPan.originalTransform;
        target.style.transition = pageBackPan.originalTransition;
        target.style.willChange = pageBackPan.originalWillChange;
        target.style.boxShadow = pageBackPan.originalBoxShadow;
        pageBackPan.target = null;
      };
      const cancelPageBackPan = () => {
        resetPageBackPan();
        const target = pageBackPan.target;
        if (!target) return;
        target.style.transition = `transform ${IOS_PAGE_BACK_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow ${IOS_PAGE_BACK_SETTLE_MS}ms ease`;
        target.style.transform = 'translate3d(0, 0, 0)';
        target.style.boxShadow = pageBackPan.originalBoxShadow;
        pageBackRestoreTimer = window.setTimeout(restorePageBackTarget, IOS_PAGE_BACK_SETTLE_MS + 40);
      };
      const preparePageBackTarget = (): boolean => {
        if (pageBackPan.target) return true;
        const target = document.querySelector('.makaron-ios-page') as HTMLElement | null;
        if (!target) return false;
        pageBackPan.target = target;
        pageBackPan.originalTransform = target.style.transform;
        pageBackPan.originalTransition = target.style.transition;
        pageBackPan.originalWillChange = target.style.willChange;
        pageBackPan.originalBoxShadow = target.style.boxShadow;
        target.style.transition = 'none';
        target.style.willChange = 'transform';
        target.style.transform = 'translate3d(0, 0, 0)';
        return true;
      };
      const setPageBackOffset = (x: number) => {
        const target = pageBackPan.target;
        if (!target) return;
        const offset = Math.max(0, Math.min(window.innerWidth, x));
        target.style.transform = `translate3d(${offset}px, 0, 0)`;
        target.style.boxShadow = offset > 1 ? '-18px 0 44px rgba(0,0,0,0.35)' : pageBackPan.originalBoxShadow;
      };
      const onPageBackTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1 || !shouldUsePageBackGesture() || isEditableElement(event.target)) return;
        const touch = event.touches[0];
        if (!touch || touch.clientX > IOS_PAGE_BACK_EDGE_PX) return;
        if (!preparePageBackTarget()) return;
        pageBackPan.tracking = true;
        pageBackPan.locked = false;
        pageBackPan.startX = touch.clientX;
        pageBackPan.startY = touch.clientY;
        pageBackPan.lastX = touch.clientX;
        pageBackPan.startTime = performance.now();
      };
      const onPageBackTouchMove = (event: TouchEvent) => {
        if (!pageBackPan.tracking) return;
        const touch = event.touches[0];
        if (!touch) return;
        const dx = touch.clientX - pageBackPan.startX;
        const dy = touch.clientY - pageBackPan.startY;
        if (!pageBackPan.locked) {
          if (dx < -IOS_PAGE_BACK_LOCK_PX || (Math.abs(dy) > IOS_PAGE_BACK_LOCK_PX && Math.abs(dy) > dx)) {
            cancelPageBackPan();
            return;
          }
          if (dx < IOS_PAGE_BACK_LOCK_PX || dx < Math.abs(dy) * 1.15) return;
          pageBackPan.locked = true;
        }
        event.preventDefault();
        pageBackPan.lastX = touch.clientX;
        setPageBackOffset(dx);
      };
      const onPageBackTouchEnd = (event: TouchEvent) => {
        if (!pageBackPan.tracking) return;
        const touch = event.changedTouches[0];
        const endX = touch?.clientX ?? pageBackPan.lastX;
        const dx = Math.max(0, endX - pageBackPan.startX);
        const elapsed = Math.max(1, performance.now() - pageBackPan.startTime);
        const velocity = dx / elapsed;
        const shouldGoBack = pageBackPan.locked && (dx >= IOS_PAGE_BACK_COMMIT_PX || velocity > 0.55);
        resetPageBackPan();
        if (!shouldGoBack || !shouldUsePageBackGesture()) {
          cancelPageBackPan();
          return;
        }
        event.preventDefault();
        const target = pageBackPan.target;
        if (target) {
          target.style.transition = `transform ${IOS_PAGE_BACK_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow ${IOS_PAGE_BACK_SETTLE_MS}ms ease`;
        }
        setPageBackOffset(window.innerWidth);
        pageBackRestoreTimer = window.setTimeout(() => {
          restorePageBackTarget();
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.assign('/home');
          }
        }, IOS_PAGE_BACK_SETTLE_MS);
      };
      window.addEventListener('touchstart', onPageBackTouchStart, { passive: true, capture: true });
      window.addEventListener('touchmove', onPageBackTouchMove, { passive: false, capture: true });
      window.addEventListener('touchend', onPageBackTouchEnd, { passive: false, capture: true });
      window.addEventListener('touchcancel', cancelPageBackPan, { passive: true, capture: true });

      const onNativePhotoInputClick = async (event: MouseEvent) => {
        const input = event.target instanceof HTMLInputElement
          ? event.target
          : event.target instanceof HTMLElement
            ? event.target.closest('input[type="file"]')
            : null;
        if (!(input instanceof HTMLInputElement) || !acceptsNativePhotoPicker(input) || !isNativePhotoLibraryPickerAvailable()) return;

        event.preventDefault();
        event.stopPropagation();

        try {
          const picked = await pickMediaFromNativePhotoLibrary({ allowVideo: nativePickerAllowsVideo(input.accept) });
          const file = await fileFromDataUrl(picked.dataUrl, picked.filename, picked.mimeType);
          const files = new DataTransfer();
          files.items.add(file);
          input.files = files.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (error) {
          console.warn('[makaron-ios-native] native photo picker cancelled or failed', error);
        }
      };
      document.addEventListener('click', onNativePhotoInputClick, { capture: true });

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
      let nativeKeyboardInset = 0;
      let viewportKeyboardInset = 0;
      const applyKeyboardInset = () => setInset(Math.max(nativeKeyboardInset, viewportKeyboardInset));

      const updateFromViewport = () => {
        const vv = window.visualViewport;
        if (!vv) return;
        viewportKeyboardInset = calculateVisualViewportKeyboardInset({
          layoutHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
        });
        applyKeyboardInset();
      };

      const keyboardShow = await Keyboard.addListener('keyboardWillShow', (info) => {
        nativeKeyboardInset = info.keyboardHeight;
        applyKeyboardInset();
      });
      const keyboardHide = await Keyboard.addListener('keyboardWillHide', () => {
        nativeKeyboardInset = 0;
        viewportKeyboardInset = 0;
        applyKeyboardInset();
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
        window.removeEventListener('touchstart', onPageBackTouchStart, { capture: true });
        window.removeEventListener('touchmove', onPageBackTouchMove, { capture: true });
        window.removeEventListener('touchend', onPageBackTouchEnd, { capture: true });
        window.removeEventListener('touchcancel', cancelPageBackPan, { capture: true });
        restorePageBackTarget();
        document.removeEventListener('click', onNativePhotoInputClick, { capture: true });
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
  }, [router]);

  return null;
}
