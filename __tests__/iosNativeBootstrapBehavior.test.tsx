import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeAppBootstrap from '@/components/NativeAppBootstrap';

const mocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
  keyboardListeners: new Map<string, (info: { keyboardHeight: number }) => void>(),
  keyboardRemove: vi.fn(),
  statusBar: {
    setOverlaysWebView: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setStyle: vi.fn(() => Promise.resolve()),
  },
  keyboard: {
    setResizeMode: vi.fn(() => Promise.resolve()),
    setStyle: vi.fn(() => Promise.resolve()),
    addListener: vi.fn((event: string, callback: (info: { keyboardHeight: number }) => void) => {
      mocks.keyboardListeners.set(event, callback);
      return Promise.resolve({ remove: mocks.keyboardRemove });
    }),
  },
  splash: {
    hide: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mocks.prefetch }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: mocks.keyboard,
  KeyboardResize: { None: 'none' },
  KeyboardStyle: { Dark: 'DARK' },
}));

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: mocks.splash,
}));

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: mocks.statusBar,
  Style: { Dark: 'DARK' },
}));

function dispatchTouch(type: string, touches: Array<{ clientX: number; clientY: number }>, changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  window.dispatchEvent(event);
}

describe('NativeAppBootstrap iOS runtime behavior', () => {
  let appendChildSpy: ReturnType<typeof vi.spyOn> | null = null;
  let userAgentSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keyboardListeners.clear();
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-native-platform');
    document.documentElement.style.removeProperty('--makaron-native-keyboard-inset');
    userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('MakaronTests MakaronIOS');
    window.history.replaceState({}, '', '/dashboard');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>cached</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 0);
      return 1;
    });

    const originalAppendChild = document.body.appendChild.bind(document.body);
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLIFrameElement) {
        node.setAttribute('srcdoc', '<!doctype html><title>cached</title>');
      }
      return originalAppendChild(node);
    });
  });

  afterEach(() => {
    userAgentSpy?.mockRestore();
    userAgentSpy = null;
    appendChildSpy?.mockRestore();
    appendChildSpy = null;
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not load native bridge behavior on the web', async () => {
    userAgentSpy?.mockReturnValue('MakaronWebTests');

    render(<NativeAppBootstrap />);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mocks.keyboard.addListener).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('makaron-ios-app')).toBe(false);
  });

  it('hides the touch-blocking splash before optional native chrome setup finishes', async () => {
    const statusBarResolvers: Array<() => void> = [];
    mocks.statusBar.setOverlaysWebView.mockImplementationOnce(() => new Promise<void>((resolve) => {
      statusBarResolvers.push(resolve);
    }));

    render(<NativeAppBootstrap />);

    await waitFor(() => {
      expect(mocks.splash.hide).toHaveBeenCalledTimes(1);
      expect(mocks.statusBar.setOverlaysWebView).toHaveBeenCalledTimes(1);
    });

    statusBarResolvers[0]?.();
  });

  it('routes Capacitor keyboard show and hide events into the native keyboard inset CSS variable', async () => {
    render(<NativeAppBootstrap />);

    await waitFor(() => {
      expect(mocks.keyboard.addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
      expect(mocks.keyboard.addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
      expect(mocks.keyboard.addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
      expect(mocks.keyboard.addListener).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));
    });

    mocks.keyboardListeners.get('keyboardDidShow')?.({ keyboardHeight: 318 });
    expect(document.documentElement.style.getPropertyValue('--makaron-native-keyboard-inset')).toBe('318px');

    mocks.keyboardListeners.get('keyboardDidHide')?.({ keyboardHeight: 0 });
    expect(document.documentElement.style.getPropertyValue('--makaron-native-keyboard-inset')).toBe('0px');
  });

  it('prewarms and reveals a previous primary page backdrop during secondary page edge-back pan', async () => {
    sessionStorage.setItem('makaron:ios-last-primary-route', '/home');
    const { container } = render(
      <>
        <main className="makaron-ios-page" style={{ minHeight: '100dvh' }}>Dashboard</main>
        <NativeAppBootstrap />
      </>,
    );
    const pageShell = container.querySelector('.makaron-ios-page') as HTMLElement;

    await waitFor(() => {
      const backdrop = document.body.querySelector('iframe');
      expect(backdrop?.getAttribute('src')).toBe('/home');
      expect(backdrop).not.toBeNull();
      expect((backdrop as HTMLIFrameElement).style.opacity).toBe('0');
    });

    dispatchTouch('touchstart', [{ clientX: 4, clientY: 120 }]);
    dispatchTouch('touchmove', [{ clientX: 136, clientY: 124 }]);

    await waitFor(() => {
      const backdrop = document.body.querySelector('iframe');
      expect(backdrop?.getAttribute('src')).toBe('/home');
      expect(backdrop).not.toBeNull();
      expect((backdrop as HTMLIFrameElement).style.opacity).toBe('1');
    });
    expect(pageShell.style.transform).toContain('translate3d(132px, 0, 0)');
    expect(pageShell.style.zIndex).toBe('2');
  });
});
