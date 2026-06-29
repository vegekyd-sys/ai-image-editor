import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';
import SkillsPage from '@/app/skills/page';
import TopBar from '@/components/TopBar';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  prefetch: vi.fn(),
  readNativeJSONCache: vi.fn(),
  writeNativeJSONCache: vi.fn(),
  warmNativeJSONCache: vi.fn(),
  navigateBackInIOSApp: vi.fn(),
  signOut: vi.fn(),
  setLocale: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    prefetch: mocks.prefetch,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/native-app-cache', () => ({
  readNativeJSONCache: mocks.readNativeJSONCache,
  writeNativeJSONCache: mocks.writeNativeJSONCache,
  warmNativeJSONCache: mocks.warmNativeJSONCache,
}));

vi.mock('@/lib/native-navigation', () => ({
  navigateBackInIOSApp: mocks.navigateBackInIOSApp,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'tianyi@example.com',
      user_metadata: { full_name: 'Tianyi' },
    },
    signOut: mocks.signOut,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({
    locale: 'zh',
    setLocale: mocks.setLocale,
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/native-app', () => ({
  isMakaronIOSApp: () => true,
  MAKARON_IOS_USER_AGENT_TOKEN: 'MakaronIOS',
}));

vi.mock('@/lib/projects-list-warm', () => ({
  warmProjectsListCache: vi.fn(),
}));

vi.mock('@/components/CreditPopup', () => ({
  default: () => null,
}));

describe('iOS secondary pages app-like behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })));
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 0);
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });

  it('renders dashboard from native cache without flashing the loading spinner', () => {
    mocks.readNativeJSONCache.mockImplementation((path: string) => {
      if (path !== '/api/billing/dashboard') return null;
      return {
        balance: 321,
        lifetimePurchased: 500,
        lifetimeUsed: 179,
        subscription: null,
        keys: [],
        usage: [],
      };
    });

    const { container } = render(<DashboardPage />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('321')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('renders skills from native cache without showing the loading state', async () => {
    mocks.readNativeJSONCache.mockImplementation((path: string) => {
      if (path !== '/api/skills') return null;
      return {
        skills: [{
          name: 'cached-skill',
          label: 'Cached Skill',
          icon: '✨',
          color: '#e879f9',
          builtIn: true,
          description: 'Ready from cache',
        }],
      };
    });

    render(<SkillsPage />);

    expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByText('Cached Skill')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(mocks.writeNativeJSONCache).not.toHaveBeenCalledWith('/api/skills', expect.objectContaining({ skills: undefined }));
  });

  it('uses the iOS native-like back helper on the skills back button before router fallback', () => {
    mocks.navigateBackInIOSApp.mockReturnValue(true);
    mocks.readNativeJSONCache.mockImplementation((path: string) => {
      if (path !== '/api/skills') return null;
      return { skills: [] };
    });

    render(<SkillsPage />);
    screen.getByRole('button', { name: /返回/ }).click();

    expect(mocks.navigateBackInIOSApp).toHaveBeenCalledWith('/projects');
    expect(mocks.push).not.toHaveBeenCalledWith('/projects');
  });

  it('keeps topbar navigation immediate and schedules warming after router push', async () => {
    const events: string[] = [];
    window.history.replaceState({}, '', '/home');
    window.addEventListener('makaron-ios-page-stack-push', ((event: CustomEvent<{ path: string }>) => {
      events.push(`stack:${event.detail.path}`);
    }) as EventListener, { once: true });
    mocks.push.mockImplementation((path: string) => events.push(`push:${path}`));
    mocks.warmNativeJSONCache.mockImplementation((path: string) => {
      events.push(`warm:${path}`);
      return Promise.resolve();
    });
    mocks.readNativeJSONCache.mockImplementation((path: string) => {
      if (path === '/api/billing/credits') return { balance: 42 };
      return null;
    });

    render(<TopBar page="home" />);
    screen.getByRole('button', { name: '打开数据面板' }).click();

    expect(events[0]).toBe('stack:/dashboard');
    expect(events[1]).toBe('push:/dashboard');
    expect(mocks.push).toHaveBeenCalledWith('/dashboard');
    expect(sessionStorage.getItem('makaron:ios-last-primary-route')).toBe('/home');
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    expect(events).toContain('warm:/api/billing/dashboard');
    expect(events.indexOf('push:/dashboard')).toBeLessThan(events.indexOf('warm:/api/billing/dashboard'));
  });

  it('keeps the account menu trigger as a reliable native-sized touch target', () => {
    mocks.readNativeJSONCache.mockImplementation((path: string) => {
      if (path === '/api/billing/credits') return { balance: 42 };
      return null;
    });

    render(<TopBar page="home" />);
    const trigger = screen.getByRole('button', { name: '打开个人菜单' });
    expect(trigger.getAttribute('data-makaron-user-menu-trigger')).toBe('true');
    expect(trigger.getAttribute('style')).toContain('min-width: 44px');
    expect(trigger.getAttribute('style')).toContain('min-height: 44px');

    fireEvent.click(trigger);
    expect(screen.getAllByText('获取 API').length).toBeGreaterThanOrEqual(1);
  });
});
