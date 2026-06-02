import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
