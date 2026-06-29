import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeIOSPageStack, { sanitizeFrozenHTMLForIOSStack } from '@/components/NativeIOSPageStack';

const mocks = vi.hoisted(() => ({
  pathname: '/projects',
  search: '',
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: () => true,
}));

describe('NativeIOSPageStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/projects';
    mocks.search = '';
    document.documentElement.dataset.nativePlatform = 'ios';
  });

  afterEach(() => {
    // Unmount each stack so its native-back event listeners don't leak into
    // the next test and trigger stray window.history.back() calls.
    cleanup();
  });

  it('keeps the previous page mounted and shows a pending native page immediately on iOS pushes', async () => {
    const { rerender, container } = render(
      <NativeIOSPageStack>
        <main>Projects page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-push', {
        detail: { path: '/dashboard' },
      }));
    });

    expect(screen.getByText('Projects page')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeTruthy();
    });

    mocks.pathname = '/dashboard';
    rerender(
      <NativeIOSPageStack>
        <main>Dashboard loaded</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(screen.getByText('Projects page')).toBeTruthy();
      expect(screen.getByText('Dashboard loaded')).toBeTruthy();
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeNull();
    });
    const underEntry = container.querySelector('[data-makaron-ios-stack-entry="under"]');
    expect(underEntry?.getAttribute('data-makaron-ios-stack-frozen')).toBe('true');
    expect(underEntry?.textContent).toContain('Projects page');
    expect(underEntry?.textContent).not.toContain('Dashboard loaded');
  });

  it('handles native back requests through the stack before falling back to history', async () => {
    const { container } = render(
      <NativeIOSPageStack>
        <main>Projects page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });
    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-push', {
        detail: { path: '/dashboard' },
      }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-stack-entry="top"]')).toBeTruthy();
    });

    const event = new CustomEvent('makaron-ios-page-stack-back', {
      cancelable: true,
      detail: { fallbackPath: '/projects' },
    });
    let dispatched = true;
    act(() => {
      dispatched = window.dispatchEvent(event);
    });

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('replaces a pending query route with the loaded query route instead of stacking a loading page underneath', async () => {
    const { rerender, container } = render(
      <NativeIOSPageStack>
        <main>Home page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-push', {
        detail: { path: '/dashboard?tab=keys' },
      }));
    });

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeTruthy();
    });

    mocks.pathname = '/dashboard';
    mocks.search = 'tab=keys';
    rerender(
      <NativeIOSPageStack>
        <main>Dashboard keys loaded</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeNull();
      expect(screen.getByText('Dashboard keys loaded')).toBeTruthy();
    });
    expect(container.querySelector('[data-makaron-ios-stack-entry="under"]')?.textContent).toContain('Home page');
    expect(container.querySelector('[data-makaron-ios-stack-entry="under"]')?.textContent).not.toContain('Loading');
  });

  it('keeps the previous page behind login while deduping repeated login routes', async () => {
    const { rerender, container } = render(
      <NativeIOSPageStack>
        <main>Projects page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-push', {
        detail: { path: '/login?next=%2Fdashboard' },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeTruthy();
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeTruthy();
    });
    expect(screen.getByText('Projects page')).toBeTruthy();

    mocks.pathname = '/login';
    mocks.search = 'next=%2Fdashboard';
    rerender(
      <NativeIOSPageStack>
        <main>Login loaded</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(screen.getByText('Login loaded')).toBeTruthy();
      expect(container.querySelector('[data-makaron-ios-stack-pending="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-makaron-ios-stack-entry="under"]')?.textContent).toContain('Projects page');
    expect(container.querySelectorAll('[data-makaron-ios-stack-entry]').length).toBe(2);

    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-push', {
        detail: { path: '/login?next=%2Fprojects' },
      }));
    });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-makaron-ios-stack-entry]').length).toBe(2);
    });
    expect(container.querySelector('[data-makaron-ios-stack-entry="under"]')?.textContent).toContain('Projects page');
    expect(screen.getByText('Login loaded')).toBeTruthy();
  });

  it('does not preserve a stacked primary tab when switching between home and projects', async () => {
    mocks.pathname = '/home';
    const { rerender, container } = render(
      <NativeIOSPageStack>
        <main>Home page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    mocks.pathname = '/projects';
    rerender(
      <NativeIOSPageStack>
        <main>Projects page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(screen.getByText('Projects page')).toBeTruthy();
    });
    expect(screen.queryByText('Home page')).toBeNull();
    expect(container.querySelector('[data-makaron-ios-stack-entry="under"]')).toBeNull();
    expect(container.querySelectorAll('[data-makaron-ios-stack-entry]').length).toBe(0);
  });

  it('sanitizes frozen underlays so Home videos cannot keep playing behind secondary pages', () => {
    const frozen = sanitizeFrozenHTMLForIOSStack(`
      <section>
        <video autoplay loop muted playsinline src="https://cdn.example.com/skill.mp4" style="position:absolute;inset:0"></video>
        <iframe src="/home"></iframe>
        <p>Home page</p>
      </section>
    `);

    expect(frozen).toContain('Home page');
    expect(frozen).toContain('data-makaron-ios-frozen-media');
    expect(frozen).not.toContain('<video');
    expect(frozen).not.toContain('<iframe');
    expect(frozen).not.toContain('autoplay');
    expect(frozen).not.toContain('skill.mp4');
  });

  it('returns to a public page client-side instead of reloading when backing out of a standalone login', async () => {
    mocks.pathname = '/login';
    mocks.search = '';
    const { container } = render(
      <NativeIOSPageStack>
        <main>Login loaded</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-back', {
        cancelable: true,
        detail: { fallbackPath: '/projects' },
      }));
    });

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/home'));
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('reveals the stacked previous page client-side (no window.history.back) when backing out of login', async () => {
    mocks.pathname = '/projects';
    mocks.search = '';
    const { rerender, container } = render(
      <NativeIOSPageStack>
        <main>Projects page</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-makaron-ios-page-stack="true"]')).toBeTruthy();
    });

    mocks.pathname = '/login';
    mocks.search = 'next=%2Fdashboard';
    rerender(
      <NativeIOSPageStack>
        <main>Login loaded</main>
      </NativeIOSPageStack>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-makaron-ios-stack-entry]').length).toBe(2);
    });

    // Pretend there is deep browser history. Without the login fix the close
    // path would call window.history.back() (which reloads across the
    // router.replace('/login') boundary) and would NOT route via the client
    // router — so asserting router.replace('/projects') proves the fix.
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(7);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(new CustomEvent('makaron-ios-page-stack-back', {
        cancelable: true,
        detail: { fallbackPath: '/projects' },
      }));
    });

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects'));
    back.mockRestore();
    lengthSpy.mockRestore();
  });
});
